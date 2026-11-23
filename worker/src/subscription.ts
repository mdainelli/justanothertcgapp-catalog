import { HttpError, type Env, type FetchFn } from "./types";

export const PLAY_PACKAGE = "io.github.mdainelli.justanothertcgapp";
export const RESULT_TTL_SECONDS = 600; // ~10 minutes
const ACTIVE_STATES = new Set(["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"]);
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface SubscriptionDeps {
  fetchFn: FetchFn;
  now: () => Date;
}

let memToken: { value: string; expiresAt: number } | null = null;

export function resetSubscriptionMemory(): void {
  memToken = null;
}

export function subscriptionCheckEnabled(env: Env): boolean {
  return env.SUBSCRIPTION_CHECK_ENABLED === "true";
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}

function b64url(data: ArrayBuffer | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function signedJwt(sa: { client_email: string; private_key: string }, nowSec: number): Promise<string> {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 }),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

/** Google OAuth access token for the Play API: cached in memory and in KV until shortly before it expires. */
async function playAccessToken(env: Env, deps: SubscriptionDeps): Promise<string> {
  const nowMs = deps.now().getTime();
  if (memToken && memToken.expiresAt > nowMs) return memToken.value;
  const cached = await env.LIMITS.get("gplay:access");
  if (cached) {
    try {
      const c = JSON.parse(cached) as { value: string; expiresAt: number };
      if (c.expiresAt > nowMs) {
        memToken = c;
        return c.value;
      }
    } catch {
      /* ignore a corrupt cache entry */
    }
  }
  let sa: { client_email: string; private_key: string };
  try {
    sa = JSON.parse(env.GOOGLE_PLAY_SERVICE_ACCOUNT ?? "");
    if (!sa.client_email || !sa.private_key) throw new Error();
  } catch {
    throw new HttpError(503, "not_configured");
  }
  let assertion: string;
  try {
    assertion = await signedJwt(sa, Math.floor(nowMs / 1000));
  } catch {
    throw new HttpError(503, "not_configured");
  }
  const res = await deps.fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  if (!res.ok) throw new HttpError(502, "upstream");
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new HttpError(502, "upstream");
  const ttl = Math.max(60, (data.expires_in ?? 3600) - 120);
  const entry = { value: data.access_token, expiresAt: nowMs + ttl * 1000 };
  memToken = entry;
  await env.LIMITS.put("gplay:access", JSON.stringify(entry), { expirationTtl: ttl });
  return entry.value;
}

/** True when the Play purchase token belongs to an active (or in grace period) subscription. */
async function playTokenActive(token: string, env: Env, deps: SubscriptionDeps): Promise<boolean> {
  const access = await playAccessToken(env, deps);
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PLAY_PACKAGE}` +
    `/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`;
  const res = await deps.fetchFn(url, { headers: { Authorization: `Bearer ${access}` } });
  if (res.status === 400 || res.status === 404 || res.status === 410) return false; // unknown or expired token
  if (res.status === 401) memToken = null;
  if (!res.ok) throw new HttpError(502, "upstream");
  const data = (await res.json()) as { subscriptionState?: string };
  return ACTIVE_STATES.has(data.subscriptionState ?? "");
}

/** Admin bypass: the Supabase user JWT is valid and `my_role` says admin. */
async function isAdmin(jwt: string, env: Env, deps: SubscriptionDeps): Promise<boolean> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return false;
  try {
    const res = await deps.fetchFn(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/my_role`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as unknown;
    return data === "admin";
  } catch {
    return false;
  }
}

async function cached(env: Env, key: string, compute: () => Promise<boolean>): Promise<boolean> {
  const hit = await env.LIMITS.get(key);
  if (hit === "1") return true;
  if (hit === "0") return false;
  const v = await compute();
  await env.LIMITS.put(key, v ? "1" : "0", { expirationTtl: RESULT_TTL_SECONDS });
  return v;
}

/**
 * Throws 402 (no purchase token) or 403 (inactive or invalid) unless the caller is an admin or holds an
 * active subscription. Tokens are never logged; KV keys use their SHA-256.
 */
export async function requireSubscription(request: Request, env: Env, deps: SubscriptionDeps): Promise<void> {
  const auth = request.headers.get("Authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (m) {
    const jwt = m[1]!;
    if (await cached(env, `adm:${await sha256Hex(jwt)}`, () => isAdmin(jwt, env, deps))) return;
  }
  const token = (request.headers.get("X-Play-Purchase-Token") ?? "").trim();
  if (!token) throw new HttpError(402, "subscription_required");
  if (token.length > 4096) throw new HttpError(403, "subscription_inactive");
  const ok = await cached(env, `sub:${await sha256Hex(token)}`, () => playTokenActive(token, env, deps));
  if (!ok) throw new HttpError(403, "subscription_inactive");
}
