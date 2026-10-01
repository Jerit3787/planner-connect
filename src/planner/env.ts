/** The part of a Workers KV namespace the rate limiter uses. Declared here
 * rather than taken from @cloudflare/workers-types, whose globals clash with
 * the DOM lib upstream's tsconfig uses. A KVNamespace satisfies it. */
export interface RateLimitStore {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

export interface Env {
  RATE_LIMIT: RateLimitStore;
  /** Firebase project NUMBER App Check tokens must be issued for. */
  FIREBASE_PROJECT_NUMBER: string;
  /** Comma-separated web origins allowed by CORS. */
  ALLOWED_ORIGINS: string;
  /** Imports per hour per network address and per student ID; default 10. */
  RATE_LIMIT_PER_HOUR?: string;
}
