import { HttpError, type Proposal } from "./types";

export const LANGS = [
  "en", "fr", "es", "es-mx", "it", "pt", "pt-br", "de", "nl", "pl", "ru", "ja", "ko", "zh-tw", "zh-cn", "id", "th",
] as const;
export const CATEGORIES = ["Pokemon", "Trainer", "Energy"] as const;
export const TYPES = [
  "Colorless", "Darkness", "Dragon", "Fairy", "Fighting", "Fire", "Grass", "Lightning", "Metal", "Psychic", "Water",
] as const;

const TOP_KEYS = [
  "formatVersion", "lang", "setId", "setName", "localId", "name", "category", "rarity", "illustrator", "types",
  "hp", "variants", "description",
];
const VARIANT_KEYS = ["normal", "reverse", "holo", "firstEdition"];
const LOCAL_ID = /^[A-Za-z0-9\-/.]{1,20}$/;
// Control characters (incl. newlines) are not allowed in single-line fields.
const CONTROL = /[\u0000-\u001f\u007f]/;
const SET_ID = /^[A-Za-z0-9\-._]{1,40}$/;

const bad = (detail: string): never => {
  throw new HttpError(400, "invalid_proposal", detail);
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function line(v: unknown, field: string, min: number, max: number): string {
  if (typeof v !== "string") return bad(`${field}: must be a string`);
  const s = v.trim();
  if (s.length < min || s.length > max) return bad(`${field}: length must be ${min}-${max}`);
  if (CONTROL.test(s)) return bad(`${field}: control characters not allowed`);
  return s;
}

function optLine(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null) return null;
  const s = line(v, field, 0, max);
  return s === "" ? null : s;
}

/** Validates the parsed `proposal` JSON; returns the normalised object. Unknown fields are rejected. */
export function validateProposal(input: unknown): Proposal {
  if (!isObject(input)) return bad("proposal must be an object");
  for (const k of Object.keys(input)) if (!TOP_KEYS.includes(k)) return bad(`unknown field: ${k}`);

  if (input.formatVersion !== 1) bad("formatVersion must be 1");
  if (typeof input.lang !== "string" || !(LANGS as readonly string[]).includes(input.lang)) bad("lang: not supported");

  let setId: string | null = null;
  if (input.setId !== undefined && input.setId !== null) {
    setId = line(input.setId, "setId", 1, 40);
    if (!SET_ID.test(setId)) bad("setId: invalid characters");
  }
  const setName = optLine(input.setName, "setName", 100);
  if (setId === null && setName === null) bad("setName is required when setId is null");

  const localId = line(input.localId, "localId", 1, 20);
  if (!LOCAL_ID.test(localId)) bad("localId: allowed characters are A-Z a-z 0-9 - / .");
  const name = line(input.name, "name", 1, 100);

  let category: Proposal["category"] = null;
  if (input.category !== undefined && input.category !== null) {
    if (!(CATEGORIES as readonly unknown[]).includes(input.category)) bad("category: must be Pokemon, Trainer, Energy or null");
    category = input.category as Proposal["category"];
  }

  const rarity = optLine(input.rarity, "rarity", 100);
  const illustrator = optLine(input.illustrator, "illustrator", 100);

  let types: string[] = [];
  if (input.types !== undefined && input.types !== null) {
    if (!Array.isArray(input.types) || input.types.length > 4) bad("types: array of at most 4 items");
    types = (input.types as unknown[]).map((t) => {
      if (typeof t !== "string" || !(TYPES as readonly string[]).includes(t)) return bad("types: unknown type code");
      return t;
    });
  }

  let hp: number | null = null;
  if (input.hp !== undefined && input.hp !== null) {
    if (typeof input.hp !== "number" || !Number.isInteger(input.hp) || input.hp < 1 || input.hp > 999) {
      bad("hp: integer 1-999 or null");
    }
    hp = input.hp as number;
  }

  const v = input.variants;
  if (!isObject(v)) return bad("variants: object required");
  for (const k of Object.keys(v)) if (!VARIANT_KEYS.includes(k)) bad(`variants: unknown field ${k}`);
  for (const k of VARIANT_KEYS) if (typeof v[k] !== "boolean") bad(`variants.${k}: boolean required`);

  const out: Proposal = {
    formatVersion: 1,
    lang: input.lang as string,
    setId,
    setName,
    localId,
    name,
    category,
    rarity,
    illustrator,
    types,
    hp,
    variants: {
      normal: v.normal as boolean,
      reverse: v.reverse as boolean,
      holo: v.holo as boolean,
      firstEdition: v.firstEdition as boolean,
    },
  };

  if (input.description !== undefined && input.description !== null) {
    if (typeof input.description !== "string") bad("description: must be a string");
    const d = (input.description as string).trim();
    if (d.length > 1000) bad("description: max 1000 chars");
    // Newlines are fine here, other control characters are not.
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(d)) bad("description: control characters not allowed");
    if (d !== "") out.description = d;
  }
  return out;
}

export function validateInstallHash(v: unknown): string {
  if (typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v)) {
    throw new HttpError(400, "invalid_install_hash");
  }
  return v;
}
