import { ebayConfigured, handleAccountDeletion, handleEbaySearch } from "./ebay";
import { HttpError, type Env, type FetchFn } from "./types";

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

export async function handleRequest(request: Request, env: Env, deps: Deps = defaultDeps): Promise<Response> {
  const { pathname } = new URL(request.url);
  try {
    if (pathname === "/health") {
      if (request.method !== "GET") throw new HttpError(405, "method_not_allowed");
      return json(200, { ok: true, ebay: ebayConfigured(env) });
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
