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

export const HASH = "a".repeat(64);

export function makeEnv(kv = new MemoryKV(), over: Partial<Env> = {}): Env {
  return { LIMITS: kv, ...over };
}

export const fixedDeps = (fetchFn: (u: string, i?: RequestInit) => Promise<Response>) => ({
  fetchFn,
  now: () => new Date("2026-11-23T10:00:00Z"),
  randomHex8: () => "deadbeef",
});
