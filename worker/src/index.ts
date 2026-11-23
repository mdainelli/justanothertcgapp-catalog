import { ebayConfigured, handleAccountDeletion, handleEbaySearch } from "./ebay";
import { GitHub, type FetchFn } from "./github";
import { buildIssueBody, issueTitle, newProposalId, photoPath } from "./issue";
import { checkJpeg, MAX_IMAGE_BYTES } from "./jpeg";
import { turnstilePage, verifyTurnstile } from "./turnstile";
import { HttpError, type Env } from "./types";
import { validateInstallHash, validateProposal } from "./validation";

export interface Deps {
  fetchFn: FetchFn;
  now: () => Date;
  randomHex8: () => string;
}

const defaultDeps: Deps = {
  fetchFn: (input, init) => fetch(input, init),
  now: () => new Date(),
  randomHex8: () => {
    const b = crypto.getRandomValues(new Uint8Array(4));
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  },
};

// Two photos of 2 MB plus form overhead.
const MAX_BODY_BYTES = 2 * MAX_IMAGE_BYTES + 256 * 1024;
const DEFAULT_LIMIT = 3;
const TTL_SECONDS = 86400;

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS },
  });
}

function errorResponse(e: HttpError): Response {
  return json(e.status, e.detail ? { error: e.code, detail: e.detail } : { error: e.code });
}

async function readImage(form: FormData, field: string, required: boolean): Promise<Uint8Array | null> {
  const v = form.get(field) as string | File | null;
  if (v === null || (typeof v === "string" && v === "")) {
    if (required) throw new HttpError(400, "invalid_image", `${field}: missing`);
    return null;
  }
  if (typeof v === "string") throw new HttpError(400, "invalid_image", `${field}: must be a file`);
  if (v.size > MAX_IMAGE_BYTES) throw new HttpError(413, "too_large", field);
  const bytes = new Uint8Array(await v.arrayBuffer());
  const r = checkJpeg(bytes);
  if (!r.ok) throw new HttpError(400, r.code, `${field}: ${r.reason}`);
  return bytes;
}

async function handleProposal(request: Request, env: Env, deps: Deps): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, "too_large");
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    throw new HttpError(400, "invalid_request", "multipart/form-data required");
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "invalid_request", "unreadable multipart body");
  }

  if (form.get("consent") !== "true") throw new HttpError(400, "invalid_consent");

  const raw = form.get("proposal");
  if (typeof raw !== "string") throw new HttpError(400, "invalid_json", "proposal field missing");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  const proposal = validateProposal(parsed);
  const installHash = validateInstallHash(form.get("installHash"));
  const front = await readImage(form, "front", true);
  const back = await readImage(form, "back", false);
  const token = form.get("turnstileToken");
  if (typeof token !== "string" || token === "" || token.length > 2048) {
    throw new HttpError(400, "invalid_turnstile_token");
  }

  // Cheap checks done: now the external ones.
  if (!(await verifyTurnstile(token, env.TURNSTILE_SECRET, deps.fetchFn))) {
    throw new HttpError(403, "turnstile_failed");
  }

  // The attempt is counted once Turnstile and validation passed and BEFORE any GitHub call,
  // so failing/looping requests cannot hammer the GitHub API. No refund on github_error.
  const limit = Number.parseInt(env.DAILY_LIMIT ?? "", 10) || DEFAULT_LIMIT;
  const used = Number.parseInt((await env.LIMITS.get(installHash)) ?? "0", 10) || 0;
  if (used >= limit) throw new HttpError(429, "daily_limit");
  await env.LIMITS.put(installHash, String(used + 1), { expirationTtl: TTL_SECONDS });

  const proposalId = newProposalId(deps.now(), deps.randomHex8());
  const gh = new GitHub(env.CATALOG_REPO, env.GITHUB_TOKEN, deps.fetchFn);
  await gh.ensureBranch();
  await gh.putFile(photoPath(proposalId, "front"), front!, `Proposta ${proposalId}`);
  if (back) await gh.putFile(photoPath(proposalId, "back"), back, `Proposta ${proposalId}`);
  const issue = await gh.createIssue(
    issueTitle(proposal),
    buildIssueBody(proposal, proposalId, back !== null, env.CATALOG_REPO),
    ["proposta"],
  );
  return json(201, { proposalId, issueNumber: issue.number, issueUrl: issue.html_url });
}

export async function handleRequest(request: Request, env: Env, deps: Deps = defaultDeps): Promise<Response> {
  const { pathname } = new URL(request.url);
  try {
    if (pathname === "/health") {
      if (request.method !== "GET") throw new HttpError(405, "method_not_allowed");
      return json(200, { ok: true, ebay: ebayConfigured(env) });
    }
    if (pathname === "/turnstile") {
      if (request.method !== "GET") throw new HttpError(405, "method_not_allowed");
      const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
      const { html, csp } = turnstilePage(env.TURNSTILE_SITE_KEY, nonce);
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": csp, ...SECURITY_HEADERS },
      });
    }
    if (pathname === "/v1/proposals") {
      if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
      return await handleProposal(request, env, deps);
    }
    if (pathname === "/ebay/search") {
      if (request.method !== "GET") throw new HttpError(405, "method_not_allowed");
      return await handleEbaySearch(request, env, deps);
    }
    if (pathname === "/ebay/account-deletion") return await handleAccountDeletion(request, env);
    throw new HttpError(404, "not_found");
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e);
    return json(500, { error: "internal_error" }); // never log payloads
  }
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handleRequest(request, env),
};
