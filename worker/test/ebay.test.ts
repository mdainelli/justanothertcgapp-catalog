import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { handleRequest } from "../src/index";
import { buildSearchUrl, CACHE_MAX_ENTRIES, resetEbayMemory, SITES } from "../src/ebay";
import { fixedDeps, HASH, makeEnv, MemoryKV } from "./helpers";

beforeEach(() => resetEbayMemory());

const Q = "pokemon Pikachu 058/198 -psa";
const BASE = "https://w.example/ebay/search";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function ebayMock(over: { items?: unknown[]; tokenFail?: boolean; searchStatus?: number; tokenStatus?: number; expiresIn?: number } = {}) {
  const calls: Call[] = [];
  const fetchFn = async (url: string, init: RequestInit = {}): Promise<Response> => {
    calls.push({ url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: init.body });
    if (url.endsWith("/identity/v1/oauth2/token")) {
      if (over.tokenStatus) return new Response("x", { status: over.tokenStatus });
      if (over.tokenFail) return new Response("secret eBay error", { status: 401 });
      return new Response(JSON.stringify({ access_token: "tok-1", expires_in: over.expiresIn ?? 7200 }));
    }
    if (url.includes("/item_summary/search")) {
      if (over.searchStatus) return new Response("secret eBay error", { status: over.searchStatus });
      return new Response(JSON.stringify({ itemSummaries: over.items ?? [] }));
    }
    return new Response("{}", { status: 404 });
  };
  return { fetchFn, calls };
}

const item = (o: Record<string, unknown> = {}) => ({
  itemId: "v1|1|0",
  title: "Pikachu",
  price: { value: "12.50", currency: "EUR" },
  buyingOptions: ["FIXED_PRICE"],
  itemEndDate: "2026-12-01T10:00:00.000Z",
  image: { imageUrl: "https://i.ebayimg.com/a.jpg" },
  itemWebUrl: "https://www.ebay.it/itm/1?mkevt=1",
  itemCreationDate: "2026-11-23T09:00:00.000Z",
  ...o,
});

const env = (kv = new MemoryKV(), over = {}) => makeEnv(kv, { EBAY_CLIENT_ID: "cid", EBAY_CLIENT_SECRET: "csec", ...over });

async function search(qs: Record<string, string>, opts: { kv?: MemoryKV; mock?: ReturnType<typeof ebayMock>; hash?: string | null; env?: ReturnType<typeof makeEnv>; now?: Date } = {}) {
  const kv = opts.kv ?? new MemoryKV();
  const mock = opts.mock ?? ebayMock();
  const url = new URL(BASE);
  for (const [k, v] of Object.entries({ q: Q, max: "20", ...qs })) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (opts.hash !== null) headers["X-Install-Hash"] = opts.hash ?? HASH;
  const deps = fixedDeps(mock.fetchFn);
  if (opts.now) deps.now = () => opts.now!;
  const res = await handleRequest(new Request(url, { headers }), opts.env ?? env(kv), deps);
  return { res, body: (await res.json()) as any, kv, mock };
}

describe("GET /ebay/search validation", () => {
  const cases: [string, Record<string, string>, string][] = [
    ["q too short", { q: " a " }, "invalid_q"],
    ["q too long", { q: "x".repeat(201) }, "invalid_q"],
    ["max missing", { max: "" }, "invalid_max"],
    ["max zero", { max: "0" }, "invalid_max"],
    ["max negative", { max: "-5" }, "invalid_max"],
    ["max too big", { max: "100000.01" }, "invalid_max"],
    ["max not a number", { max: "abc" }, "invalid_max"],
    ["opts unknown", { opts: "x" }, "invalid_opts"],
    ["site unknown", { site: "www.ebay.jp" }, "invalid_site"],
  ];
  for (const [name, qs, code] of cases) {
    it(`400 ${code}: ${name}`, async () => {
      const { res, body, mock } = await search(qs);
      expect([res.status, body.error]).toEqual([400, code]);
      expect(mock.calls).toHaveLength(0);
    });
  }
  it("400 on missing or malformed install hash", async () => {
    expect((await search({}, { hash: null })).body.error).toBe("invalid_install_hash");
    expect((await search({}, { hash: "zz" })).body.error).toBe("invalid_install_hash");
  });
  it("q missing entirely", async () => {
    const res = await handleRequest(new Request(`${BASE}?max=5`, { headers: { "X-Install-Hash": HASH } }), env(), fixedDeps(ebayMock().fetchFn));
    expect(res.status).toBe(400);
  });
  it("405 on POST", async () => {
    const res = await handleRequest(new Request(BASE, { method: "POST" }), env(), fixedDeps(ebayMock().fetchFn));
    expect(res.status).toBe(405);
  });
});

describe("GET /ebay/search", () => {
  it("503 not_configured without client id/secret, no upstream call", async () => {
    const mock = ebayMock();
    const { res, body } = await search({}, { env: makeEnv(), mock });
    expect([res.status, body]).toEqual([503, { error: "not_configured" }]);
    expect(mock.calls).toHaveLength(0);
    const half = await search({}, { env: makeEnv(new MemoryKV(), { EBAY_CLIENT_ID: "x" }), mock });
    expect(half.res.status).toBe(503);
  });

  it("returns mapped items, drops other currencies and prices above max", async () => {
    const mock = ebayMock({
      items: [
        item(),
        item({ itemId: "2", price: { value: "20.00", currency: "EUR" } }),
        item({ itemId: "3", price: { value: "20.01", currency: "EUR" } }),
        item({ itemId: "4", price: { value: "5", currency: "USD" } }),
        item({ itemId: "5", itemEndDate: undefined, image: undefined, itemCreationDate: undefined, buyingOptions: ["AUCTION"] }),
      ],
    });
    const { res, body } = await search({}, { mock });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(body.marketplace).toBe("EBAY_IT");
    expect(body.fetchedAt).toBe("2026-11-23T10:00:00.000Z");
    expect(body.items.map((i: any) => i.id)).toEqual(["v1|1|0", "2", "5"]);
    expect(body.items[0]).toEqual({
      id: "v1|1|0",
      title: "Pikachu",
      price: { value: 12.5, currency: "EUR" },
      buyingOptions: ["FIXED_PRICE"],
      endTime: "2026-12-01T10:00:00.000Z",
      image: "https://i.ebayimg.com/a.jpg",
      url: "https://www.ebay.it/itm/1?mkevt=1",
      listedAt: "2026-11-23T09:00:00.000Z",
    });
    expect(body.items[2]).toMatchObject({ endTime: null, image: null, listedAt: null, buyingOptions: ["AUCTION"] });
  });

  it("calls eBay with token request, filter, headers", async () => {
    const mock = ebayMock();
    await search({ max: "19.9", opts: "bin" }, { mock });
    const [tok, srch] = mock.calls;
    expect(tok!.url).toBe("https://api.ebay.com/identity/v1/oauth2/token");
    expect(tok!.method).toBe("POST");
    expect(tok!.headers.Authorization).toBe(`Basic ${Buffer.from("cid:csec").toString("base64")}`);
    expect(tok!.body).toBe("grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope");
    const u = new URL(srch!.url);
    expect(u.origin + u.pathname).toBe("https://api.ebay.com/buy/browse/v1/item_summary/search");
    expect(u.searchParams.get("q")).toBe(Q);
    expect(u.searchParams.get("filter")).toBe("price:[..19.9],priceCurrency:EUR,buyingOptions:{FIXED_PRICE}");
    expect(u.searchParams.get("sort")).toBe("newlyListed");
    expect(u.searchParams.get("limit")).toBe("200");
    expect(srch!.headers.Authorization).toBe("Bearer tok-1");
    expect(srch!.headers["X-EBAY-C-MARKETPLACE-ID"]).toBe("EBAY_IT");
    expect(srch!.headers["Accept-Language"]).toBeUndefined();
  });

  it("builds buyingOptions filter for auction and both", () => {
    const f = (opts: "auction" | "both") =>
      new URL(buildSearchUrl({ q: "ab", max: "5", opts, site: "www.ebay.com" })).searchParams.get("filter");
    expect(f("auction")).toBe("price:[..5],priceCurrency:USD,buyingOptions:{AUCTION}");
    expect(f("both")).toBe("price:[..5],priceCurrency:USD,buyingOptions:{AUCTION|FIXED_PRICE}");
  });

  it("maps every site to marketplace and currency", () => {
    const got = Object.fromEntries(Object.entries(SITES).map(([k, v]) => [k, `${v.marketplace} ${v.currency}`]));
    expect(got).toEqual({
      "www.ebay.it": "EBAY_IT EUR", "www.ebay.de": "EBAY_DE EUR", "www.ebay.fr": "EBAY_FR EUR",
      "www.ebay.es": "EBAY_ES EUR", "www.ebay.at": "EBAY_AT EUR", "www.ebay.nl": "EBAY_NL EUR",
      "www.ebay.ie": "EBAY_IE EUR", "www.befr.ebay.be": "EBAY_BE EUR", "www.benl.ebay.be": "EBAY_BE EUR",
      "www.ebay.co.uk": "EBAY_GB GBP", "www.ebay.com": "EBAY_US USD", "www.ebay.ch": "EBAY_CH CHF",
      "www.ebay.pl": "EBAY_PL PLN", "www.ebay.com.au": "EBAY_AU AUD", "www.ebay.ca": "EBAY_CA CAD",
    });
  });

  it("uses marketplace, currency and Accept-Language end to end", async () => {
    const mock = ebayMock({ items: [item({ price: { value: "3", currency: "CHF" } })] });
    const r = await search({ site: "www.ebay.ch" }, { mock });
    expect(r.body.marketplace).toBe("EBAY_CH");
    expect(r.body.items).toHaveLength(1);
    expect(new URL(mock.calls[1]!.url).searchParams.get("filter")).toContain("priceCurrency:CHF");

    resetEbayMemory();
    const be = ebayMock();
    await search({ site: "www.benl.ebay.be" }, { mock: be });
    expect(be.calls[1]!.headers["Accept-Language"]).toBe("nl-BE");
    expect(be.calls[1]!.headers["X-EBAY-C-MARKETPLACE-ID"]).toBe("EBAY_BE");
    resetEbayMemory();
    const fr = ebayMock();
    await search({ site: "www.befr.ebay.be" }, { mock: fr });
    expect(fr.calls[1]!.headers["Accept-Language"]).toBe("fr-BE");
  });

  it("keeps the app token in memory, and writes KV only when a new token is fetched", async () => {
    const kv = new MemoryKV();
    const mock = ebayMock();
    await search({ q: "first card" }, { kv, mock });
    await search({ q: "second card" }, { kv, mock });
    expect(mock.calls.filter((c) => c.url.includes("oauth2/token"))).toHaveLength(1);
    expect([...kv.store.keys()]).toEqual(["ebay:token"]);
    expect(kv.store.get("ebay:token")!.ttl).toBe(7200 - 300);
    // after expiry (more than 6900 s later) a new token is requested
    await search({ q: "third card" }, { kv, mock, now: new Date("2026-11-23T12:30:00Z") });
    expect(mock.calls.filter((c) => c.url.includes("oauth2/token"))).toHaveLength(2);
  });

  it("falls back to the KV token when memory is empty, without a KV write", async () => {
    const kv = new MemoryKV();
    kv.store.set("ebay:token", { value: JSON.stringify({ token: "kv-tok", expiresAt: Date.parse("2026-11-23T11:00:00Z") }) });
    const mock = ebayMock();
    await search({}, { kv, mock });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]!.headers.Authorization).toBe("Bearer kv-tok");
    expect(kv.store.get("ebay:token")!.ttl).toBeUndefined();
    await search({ q: "other" }, { kv: new MemoryKV(), mock }); // memory now holds the token
    expect(mock.calls.filter((c) => c.url.includes("oauth2/token"))).toHaveLength(0);
  });

  it("serves identical queries from the in-memory cache without calling the limiter or eBay", async () => {
    const mock = ebayMock({ items: [item()] });
    let limiterCalls = 0;
    const lim = { limit: async () => (limiterCalls++, { success: true }) };
    const kv = new MemoryKV();
    const a = await search({}, { kv, mock, env: env(kv, { EBAY_RATE_LIMITER: lim }) });
    const callsAfterFirst = mock.calls.length;
    const b = await search({}, { kv, mock, hash: "b".repeat(64), env: env(kv, { EBAY_RATE_LIMITER: lim }) });
    expect(b.body).toEqual(a.body);
    expect(mock.calls).toHaveLength(callsAfterFirst);
    expect(limiterCalls).toBe(1);
    expect([...kv.store.keys()]).toEqual(["ebay:token"]); // no cache or counter writes
    await search({ max: "21" }, { kv, mock });
    expect(mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("cache entries expire after 15 minutes and the cache is capped", async () => {
    const mock = ebayMock();
    await search({}, { mock });
    const n = mock.calls.length;
    await search({}, { mock, now: new Date("2026-11-23T10:14:00Z") });
    expect(mock.calls).toHaveLength(n);
    await search({}, { mock, now: new Date("2026-11-23T10:15:01Z") });
    expect(mock.calls.length).toBe(n + 1);
    // eviction: fill past the cap, the oldest query is searched again
    const m2 = ebayMock();
    for (let i = 0; i <= CACHE_MAX_ENTRIES; i++) await search({ q: `card ${i}` }, { mock: m2 });
    const before = m2.calls.length;
    await search({ q: "card 0" }, { mock: m2 });
    expect(m2.calls.length).toBe(before + 1);
    await search({ q: `card ${CACHE_MAX_ENTRIES}` }, { mock: m2 });
    expect(m2.calls.length).toBe(before + 1);
  });

  it("rate limiter binding: allowed, denied (429, no upstream), keyed by install hash, absent is skipped", async () => {
    const keys: string[] = [];
    const mk = (success: boolean) => ({ limit: async (o: { key: string }) => (keys.push(o.key), { success }) });
    const kv = new MemoryKV();
    const ok = await search({}, { env: env(kv, { EBAY_RATE_LIMITER: mk(true) }), kv });
    expect(ok.res.status).toBe(200);
    expect(keys).toEqual([HASH]);
    const mock = ebayMock();
    const denied = await search({ q: "other card" }, { env: env(kv, { EBAY_RATE_LIMITER: mk(false) }), kv, mock });
    expect([denied.res.status, denied.body]).toEqual([429, { error: "rate_limited" }]);
    expect(mock.calls).toHaveLength(0);
    expect((await search({ q: "third card" }, { kv })).res.status).toBe(200); // binding absent
  });

  it("eBay 429 on search or token maps to 503 quota_exhausted", async () => {
    const a = await search({}, { mock: ebayMock({ searchStatus: 429 }) });
    expect([a.res.status, a.body]).toEqual([503, { error: "quota_exhausted" }]);
    resetEbayMemory();
    const b = await search({}, { mock: ebayMock({ tokenStatus: 429 }) });
    expect([b.res.status, b.body]).toEqual([503, { error: "quota_exhausted" }]);
  });

  it("502 upstream on search failure without leaking the eBay body, and failures are not cached", async () => {
    const kv = new MemoryKV();
    const r = await search({}, { kv, mock: ebayMock({ searchStatus: 500 }) });
    expect([r.res.status, r.body]).toEqual([502, { error: "upstream" }]);
    const again = ebayMock({ items: [item()] });
    expect((await search({}, { kv, mock: again })).body.items).toHaveLength(1); // not served from cache
  });

  it("502 upstream when the token request fails", async () => {
    const r = await search({}, { mock: ebayMock({ tokenFail: true }) });
    expect([r.res.status, r.body]).toEqual([502, { error: "upstream" }]);
  });

  it("502 upstream when fetch throws", async () => {
    const mock = { calls: [], fetchFn: async () => { throw new Error("net"); } } as any;
    const r = await search({}, { mock });
    expect([r.res.status, r.body]).toEqual([502, { error: "upstream" }]);
  });
});

describe("/ebay/account-deletion", () => {
  const TOKEN = "a_verification-token_0123456789abcdef0123";
  const E = () => makeEnv(new MemoryKV(), { EBAY_VERIFICATION_TOKEN: TOKEN });
  const get = (url: string, e = E()) => handleRequest(new Request(url), e, fixedDeps(ebayMock().fetchFn));

  it("answers the challenge with sha256(code + token + endpoint url)", async () => {
    const res = await get("https://justanothertcgapp-proposals.marcod.workers.dev/ebay/account-deletion?challenge_code=abc123");
    const expected = createHash("sha256")
      .update("abc123" + TOKEN + "https://justanothertcgapp-proposals.marcod.workers.dev/ebay/account-deletion")
      .digest("hex");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ challengeResponse: expected });
  });

  it("endpoint url ignores the query string", async () => {
    const res = await get("https://w.example/ebay/account-deletion?challenge_code=zz&x=1");
    const expected = createHash("sha256").update("zz" + TOKEN + "https://w.example/ebay/account-deletion").digest("hex");
    expect(((await res.json()) as any).challengeResponse).toBe(expected);
  });

  it("503 when the verification token is missing or invalid, 400 without challenge_code", async () => {
    expect((await get("https://w.example/ebay/account-deletion?challenge_code=a", makeEnv())).status).toBe(503);
    const short = makeEnv(new MemoryKV(), { EBAY_VERIFICATION_TOKEN: "short" });
    expect((await get("https://w.example/ebay/account-deletion?challenge_code=a", short)).status).toBe(503);
    expect((await get("https://w.example/ebay/account-deletion")).status).toBe(400);
  });

  it("POST returns 204, other methods 405", async () => {
    const post = await handleRequest(
      new Request("https://w.example/ebay/account-deletion", { method: "POST", body: JSON.stringify({ metadata: {} }) }),
      makeEnv(),
      fixedDeps(ebayMock().fetchFn),
    );
    expect(post.status).toBe(204);
    const put = await handleRequest(new Request("https://w.example/ebay/account-deletion", { method: "PUT" }), makeEnv(), fixedDeps(ebayMock().fetchFn));
    expect(put.status).toBe(405);
  });
});

describe("/health ebay flag", () => {
  it("is true only when client id and secret are set, never exposes values", async () => {
    const h = async (e: ReturnType<typeof makeEnv>) =>
      handleRequest(new Request("https://w.example/health"), e, fixedDeps(ebayMock().fetchFn)).then((r) => r.text());
    expect(JSON.parse(await h(makeEnv()))).toEqual({ ok: true, ebay: false });
    const on = await h(env());
    expect(JSON.parse(on)).toEqual({ ok: true, ebay: true });
    expect(on).not.toContain("csec");
  });
});
