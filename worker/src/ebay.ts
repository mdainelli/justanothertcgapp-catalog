import type { FetchFn } from "./github";
import { HttpError, type Env } from "./types";
import { validateInstallHash } from "./validation";

export interface EbayDeps {
  fetchFn: FetchFn;
  now: () => Date;
}

const API = "https://api.ebay.com";
const SEARCH_URL = `${API}/buy/browse/v1/item_summary/search`;
const TOKEN_URL = `${API}/identity/v1/oauth2/token`;
const SCOPE = "https://api.ebay.com/oauth/api_scope";

export const CACHE_TTL_MS = 15 * 60 * 1000;
export const CACHE_MAX_ENTRIES = 500;
const TOKEN_MARGIN_SECONDS = 300;
const MAX_PRICE = 100000;

interface Site {
  marketplace: string;
  currency: string;
  language?: string;
}

export const SITES: Readonly<Record<string, Site>> = {
  "www.ebay.it": { marketplace: "EBAY_IT", currency: "EUR" },
  "www.ebay.de": { marketplace: "EBAY_DE", currency: "EUR" },
  "www.ebay.fr": { marketplace: "EBAY_FR", currency: "EUR" },
  "www.ebay.es": { marketplace: "EBAY_ES", currency: "EUR" },
  "www.ebay.at": { marketplace: "EBAY_AT", currency: "EUR" },
  "www.ebay.nl": { marketplace: "EBAY_NL", currency: "EUR" },
  "www.ebay.ie": { marketplace: "EBAY_IE", currency: "EUR" },
  "www.befr.ebay.be": { marketplace: "EBAY_BE", currency: "EUR", language: "fr-BE" },
  "www.benl.ebay.be": { marketplace: "EBAY_BE", currency: "EUR", language: "nl-BE" },
  "www.ebay.co.uk": { marketplace: "EBAY_GB", currency: "GBP" },
  "www.ebay.com": { marketplace: "EBAY_US", currency: "USD" },
  "www.ebay.ch": { marketplace: "EBAY_CH", currency: "CHF" },
  "www.ebay.pl": { marketplace: "EBAY_PL", currency: "PLN" },
  "www.ebay.com.au": { marketplace: "EBAY_AU", currency: "AUD" },
  "www.ebay.ca": { marketplace: "EBAY_CA", currency: "CAD" },
};
export const DEFAULT_SITE = "www.ebay.it";

export type BuyOpts = "auction" | "bin" | "both";

export interface SearchParams {
  q: string;
  max: string; // normalised decimal string
  opts: BuyOpts;
  site: string;
  installHash: string;
}

// Best-effort per-isolate state: an isolate can be recycled or a second one can run in parallel,
// so this only reduces upstream calls, it is never a guarantee. Nothing here is written to KV.
const resultCache = new Map<string, { body: string; expiresAt: number }>();
let memToken: { token: string; expiresAt: number } | null = null;

export function resetEbayMemory(): void {
  resultCache.clear();
  memToken = null;
}

function cacheGet(key: string, now: number): string | null {
  const e = resultCache.get(key);
  if (!e) return null;
  if (e.expiresAt <= now) {
    resultCache.delete(key);
    return null;
  }
  return e.body;
}

function cacheSet(key: string, body: string, now: number): void {
  resultCache.delete(key);
  resultCache.set(key, { body, expiresAt: now + CACHE_TTL_MS });
  while (resultCache.size > CACHE_MAX_ENTRIES) resultCache.delete(resultCache.keys().next().value!);
}

export function ebayConfigured(env: Env): boolean {
  return !!env.EBAY_CLIENT_ID && !!env.EBAY_CLIENT_SECRET;
}

export function parseSearchParams(url: URL, headers: Headers): SearchParams {
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2 || q.length > 200 || /[\u0000-\u001f\u007f]/.test(q)) throw new HttpError(400, "invalid_q");

  const rawMax = (url.searchParams.get("max") ?? "").trim();
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(rawMax)) throw new HttpError(400, "invalid_max");
  const maxNum = Number(rawMax);
  if (!(maxNum > 0) || maxNum > MAX_PRICE) throw new HttpError(400, "invalid_max");

  const opts = url.searchParams.get("opts") ?? "both";
  if (opts !== "auction" && opts !== "bin" && opts !== "both") throw new HttpError(400, "invalid_opts");

  const site = url.searchParams.get("site") ?? DEFAULT_SITE;
  if (!Object.prototype.hasOwnProperty.call(SITES, site)) throw new HttpError(400, "invalid_site");

  const installHash = validateInstallHash(headers.get("X-Install-Hash"));
  return { q, max: String(maxNum), opts, site, installHash };
}

export function buildSearchUrl(p: Pick<SearchParams, "q" | "max" | "opts" | "site">): string {
  const { currency } = SITES[p.site]!;
  const options = p.opts === "auction" ? "AUCTION" : p.opts === "bin" ? "FIXED_PRICE" : "AUCTION|FIXED_PRICE";
  const u = new URL(SEARCH_URL);
  u.searchParams.set("q", p.q);
  u.searchParams.set("filter", `price:[..${p.max}],priceCurrency:${currency},buyingOptions:{${options}}`);
  u.searchParams.set("sort", "newlyListed");
  u.searchParams.set("limit", "50");
  return u.toString();
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function appToken(env: Env, deps: EbayDeps): Promise<string> {
  const now = deps.now().getTime();
  if (memToken && memToken.expiresAt > now) return memToken.token;
  try {
    const cached = JSON.parse((await env.LIMITS.get("ebay:token")) ?? "null");
    if (cached && typeof cached.token === "string" && typeof cached.expiresAt === "number" && cached.expiresAt > now) {
      memToken = { token: cached.token, expiresAt: cached.expiresAt };
      return cached.token;
    }
  } catch {
    // unreadable cache entry: fetch a new token
  }
  let data: any;
  try {
    const res = await deps.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPE }).toString(),
    });
    if (res.status === 429) throw new HttpError(503, "quota_exhausted");
    if (!res.ok) throw new Error("token");
    data = await res.json();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, "upstream");
  }
  const expiresIn = Number(data?.expires_in);
  if (typeof data?.access_token !== "string" || !data.access_token || !(expiresIn > 0)) {
    throw new HttpError(502, "upstream");
  }
  const ttl = Math.floor(expiresIn - TOKEN_MARGIN_SECONDS);
  if (ttl > 0) {
    memToken = { token: data.access_token, expiresAt: now + ttl * 1000 };
    // The only KV write of the search path (about one per token lifetime). KV needs a TTL of at least 60 s.
    if (ttl >= 60) {
      await env.LIMITS.put("ebay:token", JSON.stringify(memToken), { expirationTtl: ttl });
    }
  }
  return data.access_token;
}

function mapItems(data: any, currency: string, max: number): unknown[] {
  const list: any[] = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];
  const out: unknown[] = [];
  for (const it of list) {
    const value = Number(it?.price?.value);
    if (!Number.isFinite(value) || it.price.currency !== currency || value > max) continue;
    if (typeof it.itemId !== "string" || typeof it.title !== "string" || typeof it.itemWebUrl !== "string") continue;
    out.push({
      id: it.itemId,
      title: it.title,
      price: { value, currency },
      buyingOptions: Array.isArray(it.buyingOptions) ? it.buyingOptions : [],
      endTime: typeof it.itemEndDate === "string" ? it.itemEndDate : null,
      image: typeof it.image?.imageUrl === "string" ? it.image.imageUrl : null,
      url: it.itemWebUrl,
      listedAt: typeof it.itemCreationDate === "string" ? it.itemCreationDate : null,
    });
  }
  return out;
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export async function handleEbaySearch(request: Request, env: Env, deps: EbayDeps): Promise<Response> {
  const p = parseSearchParams(new URL(request.url), request.headers);
  if (!ebayConfigured(env)) throw new HttpError(503, "not_configured");

  const site = SITES[p.site]!;
  const reply = (body: string) => new Response(body, { status: 200, headers: JSON_HEADERS });

  // Cached results are served without touching the rate limiter or eBay. The key never contains the install hash.
  const nowMs = deps.now().getTime();
  const cacheKey = await sha256Hex(`${p.q}\n${p.max}\n${p.opts}\n${p.site}`);
  const hit = cacheGet(cacheKey, nowMs);
  if (hit !== null) return reply(hit);

  // Workers Rate Limiting binding (no KV writes); skipped when the binding is absent (tests, dev).
  if (env.EBAY_RATE_LIMITER) {
    const { success } = await env.EBAY_RATE_LIMITER.limit({ key: p.installHash });
    if (!success) throw new HttpError(429, "rate_limited");
  }

  const token = await appToken(env, deps);
  let data: unknown;
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": site.marketplace,
    };
    if (site.language) headers["Accept-Language"] = site.language;
    const res = await deps.fetchFn(buildSearchUrl(p), { method: "GET", headers });
    if (res.status === 429) throw new HttpError(503, "quota_exhausted");
    if (!res.ok) throw new Error("search");
    data = await res.json();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, "upstream");
  }

  const body = JSON.stringify({
    items: mapItems(data, site.currency, Number(p.max)),
    fetchedAt: deps.now().toISOString(),
    marketplace: site.marketplace,
  });
  cacheSet(cacheKey, body, nowMs);
  return reply(body);
}

export const VERIFICATION_TOKEN = /^[A-Za-z0-9_-]{32,80}$/;

export async function handleAccountDeletion(request: Request, env: Env): Promise<Response> {
  if (request.method === "POST") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (request.method !== "GET") throw new HttpError(405, "method_not_allowed");
  const url = new URL(request.url);
  const challenge = url.searchParams.get("challenge_code") ?? "";
  if (challenge === "" || challenge.length > 256) throw new HttpError(400, "invalid_challenge_code");
  const token = env.EBAY_VERIFICATION_TOKEN;
  if (!token || !VERIFICATION_TOKEN.test(token)) throw new HttpError(503, "not_configured");
  const endpoint = url.origin + url.pathname;
  const challengeResponse = await sha256Hex(challenge + token + endpoint);
  return new Response(JSON.stringify({ challengeResponse }), { status: 200, headers: JSON_HEADERS });
}
