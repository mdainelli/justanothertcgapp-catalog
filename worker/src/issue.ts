import type { Proposal } from "./types";

export const MARKER = "<!-- justanothertcgapp-proposal v1 -->";

export function newProposalId(now: Date, hex8: string): string {
  const d = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `p-${d}-${hex8}`;
}

export function photoPath(proposalId: string, side: "front" | "back"): string {
  return `proposals/${proposalId}/${side}.jpg`;
}

export function rawUrl(repo: string, path: string): string {
  return `https://raw.githubusercontent.com/${repo}/proposals/${path}`;
}

export function issueTitle(p: Proposal): string {
  return `Proposta: ${p.name} (${p.lang} · ${p.setId ?? p.setName} ${p.localId})`;
}

// Defuse @mentions in the human-readable line (the JSON block is what gets parsed).
const noMention = (s: string): string => s.replaceAll("@", "@​");

export function buildIssueBody(p: Proposal, proposalId: string, hasBack: boolean, repo: string): string {
  const front = photoPath(proposalId, "front");
  const back = hasBack ? photoPath(proposalId, "back") : null;
  const frontUrl = rawUrl(repo, front);
  const photos = back
    ? `Foto: [fronte](${frontUrl}) · [retro](${rawUrl(repo, back)})`
    : `Foto: [fronte](${frontUrl})`;
  const json = JSON.stringify({ ...p, proposalId, images: { front, back } }, null, 2);
  return [
    MARKER,
    `**Carta proposta**: ${noMention(p.name)} — ${noMention(p.setName ?? p.setId ?? "")} ${p.localId} (${p.lang})`,
    "",
    photos,
    "",
    `![fronte](${frontUrl})`,
    "",
    "```json proposal",
    json,
    "```",
    "",
    "Per approvare aggiungi l'etichetta `approvata`.",
    "",
  ].join("\n");
}

/** Reference parser (what the ticket 15 Action does): the fenced `json proposal` block after the marker. */
export function parseIssueBody(body: string): unknown {
  const at = body.indexOf(MARKER);
  if (at < 0) throw new Error("marker not found");
  const m = /```json proposal\n([\s\S]*?)\n```/.exec(body.slice(at));
  if (!m) throw new Error("json proposal block not found");
  return JSON.parse(m[1]!);
}
