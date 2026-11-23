import type { Env, KVLike } from "../src/types";

export class MemoryKV implements KVLike {
  store = new Map<string, { value: string; ttl?: number }>();
  async get(k: string) {
    return this.store.get(k)?.value ?? null;
  }
  async put(k: string, value: string, o?: { expirationTtl?: number }) {
    this.store.set(k, { value, ttl: o?.expirationTtl });
  }
}

export const VALID_PROPOSAL = {
  formatVersion: 1,
  lang: "it",
  setId: "base1",
  setName: "Set Base",
  localId: "4",
  name: "Charizard",
  category: "Pokemon",
  rarity: "Rara Holo",
  illustrator: "Mitsuhiro Arita",
  types: ["Fire"],
  hp: 120,
  variants: { normal: false, reverse: false, holo: true, firstEdition: false },
  description: "Misprint",
};

/** Minimal JPEG: SOI, optional extra segments, SOF-less SOS + data, EOI. */
export function jpeg(...segments: number[][]): Uint8Array {
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
  return new Uint8Array([0xff, 0xd8, ...segments.flat(), ...sos, 0x12, 0x34, 0xff, 0xd9]);
}

export function app1(payload: string): number[] {
  const bytes = Array.from(payload, (c) => c.charCodeAt(0));
  const len = bytes.length + 2;
  return [0xff, 0xe1, len >> 8, len & 0xff, ...bytes];
}

export const HASH = "a".repeat(64);

export function makeEnv(kv = new MemoryKV(), over: Partial<Env> = {}): Env {
  return {
    LIMITS: kv,
    DAILY_LIMIT: "3",
    TURNSTILE_SITE_KEY: "site-key",
    CATALOG_REPO: "mdainelli/justanothertcgapp-catalog",
    TURNSTILE_SECRET: "secret",
    GITHUB_TOKEN: "ghp_test",
    ...over,
  };
}

export interface FormOpts {
  proposal?: unknown;
  rawProposal?: string;
  front?: Uint8Array | null;
  back?: Uint8Array | null;
  consent?: string | null;
  token?: string | null;
  hash?: string | null;
}

export function makeRequest(o: FormOpts = {}): Request {
  const f = new FormData();
  if (o.rawProposal !== undefined) f.set("proposal", o.rawProposal);
  else f.set("proposal", JSON.stringify(o.proposal ?? VALID_PROPOSAL));
  const front = o.front === undefined ? jpeg() : o.front;
  if (front) f.set("front", new File([front], "front.jpg", { type: "image/jpeg" }));
  if (o.back) f.set("back", new File([o.back], "back.jpg", { type: "image/jpeg" }));
  if (o.consent !== null) f.set("consent", o.consent ?? "true");
  if (o.token !== null) f.set("turnstileToken", o.token ?? "tok");
  if (o.hash !== null) f.set("installHash", o.hash ?? HASH);
  return new Request("https://w.example/v1/proposals", { method: "POST", body: f });
}

export interface Call {
  url: string;
  method: string;
  body: any;
}

/** Mock fetch for Turnstile + GitHub. */
export function mockFetch(opts: { turnstile?: boolean; branchExists?: boolean; githubFails?: boolean } = {}) {
  const calls: Call[] = [];
  const fetchFn = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? "GET";
    let body: any = init.body;
    if (typeof body === "string") body = JSON.parse(body);
    else if (body instanceof URLSearchParams) body = Object.fromEntries(body);
    calls.push({ url, method, body });
    const j = (s: number, v: unknown) => new Response(JSON.stringify(v), { status: s });
    if (url.includes("challenges.cloudflare.com")) return j(200, { success: opts.turnstile ?? true });
    if (opts.githubFails) return j(500, {});
    if (url.endsWith("/git/ref/heads/proposals")) return opts.branchExists ? j(200, {}) : j(404, {});
    if (url.endsWith("/git/ref/heads/main")) return j(200, { object: { sha: "abc123" } });
    if (url.endsWith("/git/refs")) return j(201, {});
    if (method === "PUT" && url.includes("/contents/")) return j(201, {});
    if (url.endsWith("/issues")) return j(201, { number: 42, html_url: "https://github.com/x/y/issues/42" });
    return j(404, {});
  };
  return { fetchFn, calls };
}

export const fixedDeps = (fetchFn: (u: string, i?: RequestInit) => Promise<Response>) => ({
  fetchFn,
  now: () => new Date("2026-11-23T10:00:00Z"),
  randomHex8: () => "deadbeef",
});
