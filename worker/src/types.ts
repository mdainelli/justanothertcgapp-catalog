export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface Env {
  LIMITS: KVLike;
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_VERIFICATION_TOKEN?: string;
  EBAY_RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
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
