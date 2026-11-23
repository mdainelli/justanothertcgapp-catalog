import { generateKeyPairSync } from "node:crypto";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { handleRequest } from "../src/index";
import { resetEbayMemory } from "../src/ebay";
import { resetSubscriptionMemory } from "../src/subscription";
import { fixedDeps, HASH, makeEnv, MemoryKV } from "./helpers";

beforeEach(() => {
  resetEbayMemory();
  resetSubscriptionMemory();
});

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA = JSON.stringify({
  client_email: "sa@proj.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
});
const URL_ = "https://w.example/ebay/search?q=pokemon%20Pikachu&max=20";
const TOKEN = "play-token-SECRET-123";

function mock(o: { state?: string; playStatus?: number; role?: unknown; roleStatus?: number; oauthStatus?: number } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string, init: RequestInit = {}): Promise<Response> => {
    calls.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token")
      return o.oauthStatus ? new Response("x", { status: o.oauthStatus }) : new Response(JSON.stringify({ access_token: "gat", expires_in: 3600 }));
    if (url.includes("/purchases/subscriptionsv2/tokens/"))
      return o.playStatus ? new Response("{}", { status: o.playStatus }) : new Response(JSON.stringify({ subscriptionState: o.state ?? "SUBSCRIPTION_STATE_ACTIVE" }));
    if (url.endsWith("/rest/v1/rpc/my_role"))
      return o.roleStatus ? new Response("{}", { status: o.roleStatus }) : new Response(JSON.stringify(o.role ?? "user"));
    if (url.includes("/identity/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "e", expires_in: 7200 }));
    if (url.includes("/item_summary/search")) return new Response(JSON.stringify({ itemSummaries: [] }));
    return new Response("{}", { status: 404 });
  };
  return { fetchFn, calls, count: (s: string) => calls.filter((c) => c.url.includes(s)).length };
}

const env = (kv: MemoryKV, over = {}) =>
  makeEnv(kv, {
    EBAY_CLIENT_ID: "c",
    EBAY_CLIENT_SECRET: "s",
    SUBSCRIPTION_CHECK_ENABLED: "true",
    GOOGLE_PLAY_SERVICE_ACCOUNT: SA,
    SUPABASE_URL: "https://sb.example",
    SUPABASE_ANON_KEY: "anon",
    ...over,
  });

async function call(m: ReturnType<typeof mock>, headers: Record<string, string> = {}, kv = new MemoryKV(), e = env(kv)) {
  const res = await handleRequest(new Request(URL_, { headers: { "X-Install-Hash": HASH, ...headers } }), e, fixedDeps(m.fetchFn));
  return { res, text: await res.clone().text(), kv };
}

describe("subscription check", () => {
  it("is off by default: no token needed, no Play calls", async () => {
    const m = mock();
    for (const over of [{ SUBSCRIPTION_CHECK_ENABLED: undefined }, { SUBSCRIPTION_CHECK_ENABLED: "false" }]) {
      const { res } = await call(m, {}, new MemoryKV(), env(new MemoryKV(), over));
      expect(res.status).toBe(200);
    }
    expect(m.count("googleapis")).toBe(0);
  });

  it("missing token -> 402", async () => {
    const { res } = await call(mock());
    expect(res.status).toBe(402);
  });

  it("active subscription -> 200, calls the Play API with package and bearer", async () => {
    const m = mock();
    const { res } = await call(m, { "X-Play-Purchase-Token": TOKEN });
    expect(res.status).toBe(200);
    const play = m.calls.find((c) => c.url.includes("subscriptionsv2"))!;
    expect(play.url).toContain("applications/io.github.mdainelli.justanothertcgapp/purchases/subscriptionsv2/tokens/");
    expect((play.init.headers as Record<string, string>).Authorization).toBe("Bearer gat");
    const oauth = m.calls.find((c) => c.url === "https://oauth2.googleapis.com/token")!;
    expect(String(oauth.init.body)).toContain("assertion=");
  });

  it("grace period -> 200", async () => {
    expect((await call(mock({ state: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" }), { "X-Play-Purchase-Token": TOKEN })).res.status).toBe(200);
  });

  it.each(["SUBSCRIPTION_STATE_ON_HOLD", "SUBSCRIPTION_STATE_EXPIRED", "SUBSCRIPTION_STATE_CANCELED", "SUBSCRIPTION_STATE_PAUSED"])(
    "%s -> 403",
    async (state) => {
      expect((await call(mock({ state }), { "X-Play-Purchase-Token": TOKEN })).res.status).toBe(403);
    },
  );

  it("invalid token (Play 404/410/400) -> 403", async () => {
    for (const playStatus of [400, 404, 410]) {
      resetSubscriptionMemory();
      expect((await call(mock({ playStatus }), { "X-Play-Purchase-Token": TOKEN })).res.status).toBe(403);
    }
  });

  it("Play API outage -> 502 and the failure is not cached", async () => {
    const kv = new MemoryKV();
    expect((await call(mock({ playStatus: 500 }), { "X-Play-Purchase-Token": TOKEN }, kv)).res.status).toBe(502);
    expect((await call(mock(), { "X-Play-Purchase-Token": TOKEN }, kv)).res.status).toBe(200);
  });

  it("OAuth failure -> 502; bad service account -> 503", async () => {
    expect((await call(mock({ oauthStatus: 401 }), { "X-Play-Purchase-Token": TOKEN })).res.status).toBe(502);
    resetSubscriptionMemory();
    const kv = new MemoryKV();
    const r = await call(mock(), { "X-Play-Purchase-Token": TOKEN }, kv, env(kv, { GOOGLE_PLAY_SERVICE_ACCOUNT: "nope" }));
    expect(r.res.status).toBe(503);
  });

  it("caches the result in KV by sha256(token) for 10 minutes, never storing the token", async () => {
    const kv = new MemoryKV();
    const m = mock();
    await call(m, { "X-Play-Purchase-Token": TOKEN }, kv);
    await call(m, { "X-Play-Purchase-Token": TOKEN }, kv);
    expect(m.count("subscriptionsv2")).toBe(1);
    const key = "sub:" + createHash("sha256").update(TOKEN).digest("hex");
    expect(kv.store.get(key)).toEqual({ value: "1", ttl: 600 });
    for (const [k, v] of kv.store) expect(k + v.value).not.toContain(TOKEN);
  });

  it("caches the Google access token across tokens", async () => {
    const kv = new MemoryKV();
    const m = mock();
    await call(m, { "X-Play-Purchase-Token": "t1" }, kv);
    await call(m, { "X-Play-Purchase-Token": "t2" }, kv);
    expect(m.count("oauth2.googleapis.com")).toBe(1);
    expect(m.count("subscriptionsv2")).toBe(2);
  });

  it("never echoes the token in responses", async () => {
    const r = await call(mock({ state: "SUBSCRIPTION_STATE_EXPIRED" }), { "X-Play-Purchase-Token": TOKEN });
    expect(r.text).not.toContain(TOKEN);
  });

  it("admin JWT bypasses the check without a purchase token", async () => {
    const m = mock({ role: "admin" });
    const { res } = await call(m, { Authorization: "Bearer jwt-1" });
    expect(res.status).toBe(200);
    const rpc = m.calls.find((c) => c.url === "https://sb.example/rest/v1/rpc/my_role")!;
    expect((rpc.init.headers as Record<string, string>).apikey).toBe("anon");
    expect(m.count("subscriptionsv2")).toBe(0);
  });

  it("non-admin JWT without token -> 402; with active token -> 200", async () => {
    expect((await call(mock({ role: "user" }), { Authorization: "Bearer jwt-1" })).res.status).toBe(402);
    expect((await call(mock({ role: "user" }), { Authorization: "Bearer jwt-1", "X-Play-Purchase-Token": TOKEN })).res.status).toBe(200);
  });

  it("invalid JWT (Supabase error) falls back to the purchase token rules", async () => {
    expect((await call(mock({ roleStatus: 401 }), { Authorization: "Bearer bad" })).res.status).toBe(402);
    expect((await call(mock({ roleStatus: 401 }), { Authorization: "Bearer bad", "X-Play-Purchase-Token": TOKEN })).res.status).toBe(200);
  });

  it("admin bypass is off when Supabase is not configured", async () => {
    const kv = new MemoryKV();
    const r = await call(mock({ role: "admin" }), { Authorization: "Bearer jwt-1" }, kv, env(kv, { SUPABASE_URL: "" }));
    expect(r.res.status).toBe(402);
  });
});
