import { HttpError, type NameSuggestion } from "./types";
import { LANGS } from "./validation";

export const NAME_MARKER = "<!-- justanothertcgapp-name-suggestion v1 -->";

const TARGETS = ["set", "card"] as const;
// Ids: TCGdex set ids ("SV6", "base1"), card ids ("SV1S-001", "sv1-001") and extra ids ("x-ja-...").
const NAME_ID = /^[A-Za-z0-9][A-Za-z0-9\-._]{0,59}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
// Markdown/HTML/link syntax has no place in a name; the `original` is only ever shown, never trusted.
const ORIGINAL_FORBIDDEN = /[<>[\]`@]|:\/\//;
// English names: Latin/Greek letters, digits, space and a few punctuation marks (Mr. Mime, Farfetch'd,
// Type: Null, Nidoran♀, Pikachu & Zekrom-GX). No '@', '#', '*', '_', '[', '<', '`' etc.
const ENGLISH_CHARS = /^[\p{Script=Latin}\p{Script=Greek}\p{Nd} '’.,:!?&+\-–()/·♀♂]+$/u;
const ENGLISH_START = /^[\p{Script=Latin}\p{Script=Greek}\p{Nd}]/u;

const bad = (detail: string): never => {
  throw new HttpError(400, "invalid_suggestion", detail);
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(v: unknown, field: string, max: number): string {
  if (typeof v !== "string") return bad(`${field}: must be a string`);
  const s = v.trim().normalize("NFC");
  if (s.length < 1 || s.length > max) return bad(`${field}: length must be 1-${max}`);
  if (CONTROL.test(s)) return bad(`${field}: control characters not allowed`);
  return s;
}

/** True when the text contains something that looks like a URL or a domain name. */
export function looksLikeUrl(s: string): boolean {
  return /:\/\/|www\.|\b[\p{L}\p{N}-]+\.(com|net|org|io|dev|app|me|it|co|gg|ly|xyz|info|biz|ru|cn|jp)\b/iu.test(s);
}

export function validateEnglishName(v: unknown, field = "english"): string {
  const s = text(v, field, 100);
  if (!ENGLISH_START.test(s) || !ENGLISH_CHARS.test(s)) {
    return bad(`${field}: only Latin letters, digits and basic punctuation are allowed`);
  }
  if (looksLikeUrl(s)) return bad(`${field}: links are not allowed`);
  return s;
}

/** Validates the JSON body of a name suggestion; returns the normalised pairing (without consent/hash/token). */
export function validateNameSuggestion(input: unknown): NameSuggestion {
  if (!isObject(input)) return bad("body must be an object");
  const KEYS = ["target", "lang", "id", "original", "english", "consent", "installHash", "turnstileToken"];
  for (const k of Object.keys(input)) if (!KEYS.includes(k)) return bad(`unknown field: ${k}`);

  if (!(TARGETS as readonly unknown[]).includes(input.target)) bad("target: must be set or card");
  if (typeof input.lang !== "string" || !(LANGS as readonly string[]).includes(input.lang)) bad("lang: not supported");
  const id = text(input.id, "id", 60);
  if (!NAME_ID.test(id)) bad("id: invalid characters");
  const original = text(input.original, "original", 100);
  if (ORIGINAL_FORBIDDEN.test(original)) bad("original: invalid characters");
  const english = validateEnglishName(input.english);
  return { target: input.target as NameSuggestion["target"], lang: input.lang as string, id, original, english };
}

export function newSuggestionId(now: Date, hex8: string): string {
  return `n-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${hex8}`;
}

export function nameIssueTitle(s: NameSuggestion): string {
  return `Nome inglese: ${s.original} → ${s.english}`;
}

const noMention = (s: string): string => s.replaceAll("@", "@​");

export function buildNameIssueBody(s: NameSuggestion, suggestionId: string): string {
  const json = JSON.stringify({ formatVersion: 1, ...s, proposalId: suggestionId }, null, 2);
  const what = s.target === "set" ? "set" : "carta";
  return [
    NAME_MARKER,
    `**Nome inglese proposto** (${what} \`${s.id}\`, ${s.lang}): ${noMention(s.original)} → ${noMention(s.english)}`,
    "",
    "```json name-suggestion",
    json,
    "```",
    "",
    "Per approvare aggiungi l'etichetta `approvata`.",
    "",
  ].join("\n");
}

/** Reference parser (what the approval script does): the fenced `json name-suggestion` block after the marker. */
export function parseNameIssueBody(body: string): unknown {
  const at = body.indexOf(NAME_MARKER);
  if (at < 0) throw new Error("marker not found");
  const m = /```json name-suggestion\n([\s\S]*?)\n```/.exec(body.slice(at));
  if (!m) throw new Error("json name-suggestion block not found");
  return JSON.parse(m[1]!);
}
