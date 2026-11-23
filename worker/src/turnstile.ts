import type { FetchFn } from "./github";

export const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** True only when Cloudflare confirms the token. The client IP is deliberately not forwarded. */
export async function verifyTurnstile(token: string, secret: string, fetchFn: FetchFn): Promise<boolean> {
  try {
    const res = await fetchFn(SITEVERIFY, {
      method: "POST",
      body: new URLSearchParams({ secret, response: token }),
    });
    if (!res.ok) return false;
    return ((await res.json()) as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function turnstilePage(siteKey: string, nonce: string): { html: string; csp: string } {
  const html = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verifica</title>
<script nonce="${nonce}">
function onToken(t){ if (window.Android && window.Android.onToken) window.Android.onToken(t); }
</script>
<style nonce="${nonce}">body{margin:0;display:flex;justify-content:center;padding:16px}</style>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</head><body>
<div class="cf-turnstile" data-sitekey="${esc(siteKey)}" data-callback="onToken"></div>
</body></html>`;
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' https://challenges.cloudflare.com`,
    "frame-src https://challenges.cloudflare.com",
    "connect-src https://challenges.cloudflare.com",
    `style-src 'nonce-${nonce}'`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  return { html, csp };
}
