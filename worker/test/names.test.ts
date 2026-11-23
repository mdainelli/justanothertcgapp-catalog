import { describe, expect, it } from "vitest";
import { handleRequest } from "../src/index";
import { buildNameIssueBody, nameIssueTitle, parseNameIssueBody, validateNameSuggestion } from "../src/names";
import { fixedDeps, HASH, makeEnv, MemoryKV, mockFetch } from "./helpers";

const VALID = { target: "set", lang: "ja", id: "SV6", original: "変幻の仮面", english: "Mask of Change" };

function req(over: Record<string, unknown> = {}, opts: { contentType?: string; raw?: string } = {}): Request {
  const body: Record<string, unknown> = { ...VALID, consent: true, installHash: HASH, turnstileToken: "tok", ...over };
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  return new Request("https://w.example/v1/name-suggestions", {
    method: "POST",
    headers: { "Content-Type": opts.contentType ?? "application/json" },
    body: opts.raw ?? JSON.stringify(body),
  });
}

async function run(r: Request, mo: Parameters<typeof mockFetch>[0] = {}, kv = new MemoryKV(), env = makeEnv(kv)) {
  const m = mockFetch(mo);
  const res = await handleRequest(r, env, fixedDeps(m.fetchFn));
  return { res, body: (await res.json()) as any, calls: m.calls, kv };
}

describe("POST /v1/name-suggestions", () => {
  it("201: opens an issue labelled proposta+nome with a parseable block, no branch or photos", async () => {
    const { res, body, calls, kv } = await run(req());
    expect(res.status).toBe(201);
    expect(body).toEqual({ proposalId: "n-20261123-deadbeef", issueNumber: 42, issueUrl: "https://github.com/x/y/issues/42" });
    const repo = "https://api.github.com/repos/mdainelli/justanothertcgapp-catalog";
    expect(calls.map((c) => `${c.method} ${c.url.replace(repo, "")}`)).toEqual([
      "POST https://challenges.cloudflare.com/turnstile/v0/siteverify",
      "POST /issues",
    ]);
    const issue = calls[1]!.body;
    expect(issue.labels).toEqual(["proposta", "nome"]);
    expect(issue.title).toBe("Nome inglese: 変幻の仮面 → Mask of Change");
    expect(parseNameIssueBody(issue.body)).toEqual({ formatVersion: 1, ...VALID, proposalId: "n-20261123-deadbeef" });
    expect(kv.store.get(`n:${HASH}`)).toEqual({ value: "1", ttl: 86400 });
    expect(kv.store.has(HASH)).toBe(false);
  });

  it("does not use the card proposal counter", async () => {
    const kv = new MemoryKV();
    kv.store.set(HASH, { value: "3" });
    expect((await run(req(), {}, kv)).res.status).toBe(201);
  });

  it("429 daily_limit, GitHub untouched", async () => {
    const kv = new MemoryKV();
    kv.store.set(`n:${HASH}`, { value: "3" });
    const { res, body, calls } = await run(req(), {}, kv);
    expect(res.status).toBe(429);
    expect(body).toEqual({ error: "daily_limit" });
    expect(calls.every((c) => c.url.includes("challenges.cloudflare.com"))).toBe(true);
  });

  it("403 turnstile_failed, nothing counted", async () => {
    const { res, body, kv, calls } = await run(req(), { turnstile: false });
    expect(res.status).toBe(403);
    expect(body.error).toBe("turnstile_failed");
    expect(calls).toHaveLength(1);
    expect(kv.store.size).toBe(0);
  });

  it("502 github_error still counts the attempt", async () => {
    const { res, kv } = await run(req(), { githubFails: true });
    expect(res.status).toBe(502);
    expect(kv.store.get(`n:${HASH}`)?.value).toBe("1");
  });

  it.each([
    ["consent missing", { consent: undefined }, "invalid_consent"],
    ["consent not boolean true", { consent: "true" }, "invalid_consent"],
    ["bad hash", { installHash: "xyz" }, "invalid_install_hash"],
    ["token missing", { turnstileToken: undefined }, "invalid_turnstile_token"],
    ["bad target", { target: "pack" }, "invalid_suggestion"],
    ["bad lang", { lang: "xx" }, "invalid_suggestion"],
    ["empty english", { english: "  " }, "invalid_suggestion"],
    ["unknown field", { extra: 1 }, "invalid_suggestion"],
  ])("400 for %s", async (_n, over, code) => {
    const { res, body, calls } = await run(req(over as Record<string, unknown>));
    expect(res.status).toBe(400);
    expect(body.error).toBe(code);
    expect(calls).toHaveLength(0);
  });

  it("400 invalid_json and invalid_request (content type)", async () => {
    expect((await run(req({}, { raw: "{nope" }))).body.error).toBe("invalid_json");
    expect((await run(req({}, { contentType: "text/plain" }))).body.error).toBe("invalid_request");
  });

  it("413 for a huge body", async () => {
    const { res, body } = await run(req({ original: "あ".repeat(9000) }));
    expect(res.status).toBe(413);
    expect(body.error).toBe("too_large");
  });

  it("405 on GET", async () => {
    const res = await handleRequest(
      new Request("https://w.example/v1/name-suggestions"), makeEnv(), fixedDeps(mockFetch().fetchFn),
    );
    expect(res.status).toBe(405);
  });
});

describe("validateNameSuggestion", () => {
  const ok = (over: Record<string, unknown>) => validateNameSuggestion({ ...VALID, ...over });
  it("accepts typical names", () => {
    for (const e of ["Mr. Mime", "Farfetch'd", "Type: Null", "Nidoran♀", "Pikachu & Zekrom-GX", "Flabébé", "Boss’s Orders", "N", "Porygon-Z"]) {
      expect(ok({ english: e }).english).toBe(e);
    }
  });
  it("trims and accepts a card id", () => {
    expect(ok({ target: "card", id: "SV1S-001", english: "  Cacnea " })).toEqual({
      target: "card", lang: "ja", id: "SV1S-001", original: VALID.original, english: "Cacnea",
    });
  });
  it("rejects URLs, markup, mentions, CJK, control chars and length", () => {
    for (const e of ["http://evil.example", "see evil.com", "www.x", "@owner", "<b>x</b>", "[a](b)", "`x`", "サボネア", "a\nb", "-x", "x".repeat(101), "a_b", "#1"]) {
      expect(() => ok({ english: e }), e).toThrow();
    }
  });
  it("rejects bad ids and originals", () => {
    expect(() => ok({ id: "a b" })).toThrow();
    expect(() => ok({ id: "../x" })).toThrow();
    expect(() => ok({ original: "[x](http://e.com)" })).toThrow();
    expect(() => ok({ original: "" })).toThrow();
    expect(() => ok({ original: "あ".repeat(101) })).toThrow();
  });
});

describe("issue builder", () => {
  it("builds title and exact body", () => {
    const s = validateNameSuggestion(VALID);
    expect(nameIssueTitle(s)).toBe("Nome inglese: 変幻の仮面 → Mask of Change");
    expect(buildNameIssueBody(s, "n-20261123-deadbeef")).toBe(`<!-- justanothertcgapp-name-suggestion v1 -->
**Nome inglese proposto** (set \`SV6\`, ja): 変幻の仮面 → Mask of Change

\`\`\`json name-suggestion
{
  "formatVersion": 1,
  "target": "set",
  "lang": "ja",
  "id": "SV6",
  "original": "変幻の仮面",
  "english": "Mask of Change",
  "proposalId": "n-20261123-deadbeef"
}
\`\`\`

Per approvare aggiungi l'etichetta \`approvata\`.
`);
  });
});
