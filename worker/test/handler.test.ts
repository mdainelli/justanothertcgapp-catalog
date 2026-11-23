import { describe, expect, it } from "vitest";
import { handleRequest } from "../src/index";
import { app1, fixedDeps, jpeg, makeEnv, makeRequest, MemoryKV, mockFetch, HASH } from "./helpers";
import { parseIssueBody } from "../src/issue";

async function run(req: Request, opts: Parameters<typeof mockFetch>[0] = {}, kv = new MemoryKV(), env = makeEnv(kv)) {
  const m = mockFetch(opts);
  const res = await handleRequest(req, env, fixedDeps(m.fetchFn));
  return { res, body: (await res.json()) as any, calls: m.calls, kv };
}

describe("POST /v1/proposals", () => {
  it("201 on success: branch created, photos committed, issue opened, counter set", async () => {
    const { res, body, calls, kv } = await run(makeRequest({ back: jpeg() }));
    expect(res.status).toBe(201);
    expect(body).toEqual({
      proposalId: "p-20261123-deadbeef",
      issueNumber: 42,
      issueUrl: "https://github.com/x/y/issues/42",
    });
    const repo = "https://api.github.com/repos/mdainelli/justanothertcgapp-catalog";
    expect(calls.map((c) => `${c.method} ${c.url.replace(repo, "")}`)).toEqual([
      "POST https://challenges.cloudflare.com/turnstile/v0/siteverify",
      "GET /git/ref/heads/proposals",
      "GET /git/ref/heads/main",
      "POST /git/refs",
      "PUT /contents/proposals/p-20261123-deadbeef/front.jpg",
      "PUT /contents/proposals/p-20261123-deadbeef/back.jpg",
      "POST /issues",
    ]);
    expect(calls[0]!.body).toEqual({ secret: "secret", response: "tok" });
    expect(calls[3]!.body).toEqual({ ref: "refs/heads/proposals", sha: "abc123" });
    expect(calls[4]!.body).toMatchObject({ message: "Proposta p-20261123-deadbeef", branch: "proposals" });
    const issue = calls[6]!.body;
    expect(issue.labels).toEqual(["proposta"]);
    expect(issue.title).toBe("Proposta: Charizard (it · base1 4)");
    expect((parseIssueBody(issue.body) as any).proposalId).toBe("p-20261123-deadbeef");
    expect(kv.store.get(HASH)).toEqual({ value: "1", ttl: 86400 });
  });

  it("skips branch creation when it exists, and back photo when absent", async () => {
    const { res, calls } = await run(makeRequest(), { branchExists: true });
    expect(res.status).toBe(201);
    expect(calls.some((c) => c.url.endsWith("/git/refs"))).toBe(false);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("403 turnstile_failed, nothing counted and GitHub untouched", async () => {
    const { res, body, calls, kv } = await run(makeRequest(), { turnstile: false });
    expect(res.status).toBe(403);
    expect(body.error).toBe("turnstile_failed");
    expect(calls).toHaveLength(1);
    expect(kv.store.size).toBe(0);
  });

  it("429 daily_limit after the limit is reached", async () => {
    const kv = new MemoryKV();
    kv.store.set(HASH, { value: "3" });
    const { res, body, calls } = await run(makeRequest(), {}, kv);
    expect(res.status).toBe(429);
    expect(body).toEqual({ error: "daily_limit" });
    expect(calls.every((c) => c.url.includes("challenges.cloudflare.com"))).toBe(true);
  });

  it("increments until the limit (DAILY_LIMIT from env)", async () => {
    const kv = new MemoryKV();
    const env = makeEnv(kv, { DAILY_LIMIT: "2" });
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await run(makeRequest(), {}, kv, env)).res.status);
    expect(codes).toEqual([201, 201, 429]);
  });

  it("counts an attempt even when GitHub fails (502)", async () => {
    const { res, body, kv } = await run(makeRequest(), { githubFails: true });
    expect(res.status).toBe(502);
    expect(body.error).toBe("github_error");
    expect(kv.store.get(HASH)?.value).toBe("1");
  });

  it("400 invalid_json", async () => {
    const { res, body } = await run(makeRequest({ rawProposal: "{nope" }));
    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_json");
  });

  it("400 invalid_proposal for unknown fields", async () => {
    const { res, body } = await run(makeRequest({ proposal: { formatVersion: 1, evil: true } }));
    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_proposal");
  });

  it("413 too_large for an image over 2 MB", async () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set([0xff, 0xd8]);
    const { res, body } = await run(makeRequest({ front: big }));
    expect(res.status).toBe(413);
    expect(body.error).toBe("too_large");
  });

  it("413 too_large from Content-Length alone", async () => {
    const req = new Request("https://w.example/v1/proposals", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": "99999999" },
      body: "x",
    });
    const { res } = await run(req);
    expect(res.status).toBe(413);
  });

  it.each([
    ["missing", null],
    ["false", "false"],
    ["empty", ""],
  ])("400 invalid_consent when consent is %s", async (_n, consent) => {
    const { res, body, calls } = await run(makeRequest({ consent }));
    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_consent");
    expect(calls).toHaveLength(0);
  });

  it("400 invalid_image for non-JPEG and invalid_image_metadata for EXIF", async () => {
    let r = await run(makeRequest({ front: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]) }));
    expect([r.res.status, r.body.error]).toEqual([400, "invalid_image"]);
    r = await run(makeRequest({ back: jpeg(app1("Exif\0\0")) }));
    expect([r.res.status, r.body.error]).toEqual([400, "invalid_image_metadata"]);
    r = await run(makeRequest({ front: null }));
    expect([r.res.status, r.body.error]).toEqual([400, "invalid_image"]);
  });

  it("400 for bad install hash, missing token, non-multipart", async () => {
    expect((await run(makeRequest({ hash: "nothex" }))).body.error).toBe("invalid_install_hash");
    expect((await run(makeRequest({ token: null }))).body.error).toBe("invalid_turnstile_token");
    const r = await run(new Request("https://w.example/v1/proposals", { method: "POST", body: "{}" }));
    expect(r.body.error).toBe("invalid_request");
  });
});

describe("other routes", () => {
  it("GET /health", async () => {
    const { res, body } = await run(new Request("https://w.example/health"));
    expect([res.status, body]).toEqual([200, { ok: true }]);
  });
  it("GET /turnstile serves the widget with a strict CSP", async () => {
    const res = await handleRequest(new Request("https://w.example/turnstile"), makeEnv());
    const html = await res.text();
    const csp = res.headers.get("content-security-policy")!;
    expect(html).toContain('data-sitekey="site-key"');
    expect(html).toContain("window.Android.onToken(t)");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("https://challenges.cloudflare.com");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toMatch(/https?:\/\/(?!challenges\.cloudflare\.com)/);
  });
  it("404 and 405", async () => {
    expect((await run(new Request("https://w.example/nope"))).res.status).toBe(404);
    expect((await run(new Request("https://w.example/v1/proposals"))).res.status).toBe(405);
  });
});
