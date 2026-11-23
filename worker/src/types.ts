export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  LIMITS: KVLike;
  DAILY_LIMIT?: string;
  TURNSTILE_SITE_KEY: string;
  CATALOG_REPO: string;
  TURNSTILE_SECRET: string;
  GITHUB_TOKEN: string;
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_VERIFICATION_TOKEN?: string;
  EBAY_RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

export type Variants = { normal: boolean; reverse: boolean; holo: boolean; firstEdition: boolean };

/** Normalised proposal: every field present (description only when given). */
export interface Proposal {
  formatVersion: 1;
  lang: string;
  setId: string | null;
  setName: string | null;
  localId: string;
  name: string;
  category: "Pokemon" | "Trainer" | "Energy" | null;
  rarity: string | null;
  illustrator: string | null;
  types: string[];
  hp: number | null;
  variants: Variants;
  description?: string;
}

/** Error with the HTTP status and the machine code returned to the app. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public detail?: string,
  ) {
    super(code);
  }
}
