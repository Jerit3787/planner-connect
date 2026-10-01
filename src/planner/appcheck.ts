// Firebase App Check verification: only a genuine copy of the planner app
// may ask this Worker to sign in to a portal. Ported from
// planner-notify-worker's appcheck.js (our own code, licensed AGPL here).
const JWKS_URL = "https://firebaseappcheck.googleapis.com/v1/jwks";

export class AppCheckError extends Error {}

const bytes = (s: string) => {
  const bin = atob(
    s
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(s.length + ((4 - (s.length % 4)) % 4), "="),
  );
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const json = (s: string) => JSON.parse(new TextDecoder().decode(bytes(s)));

let cache: { keys: JsonWebKey[]; at: number } | null = null;

async function keyFor(kid: string, fetchFn: typeof fetch) {
  if (!cache || Date.now() - cache.at > 3_600_000) {
    const res = await fetchFn(JWKS_URL);
    if (!res.ok) throw new AppCheckError("jwks unavailable");
    const body = (await res.json()) as { keys?: JsonWebKey[] };
    cache = { keys: body.keys ?? [], at: Date.now() };
  }
  const jwk = cache.keys.find((k) => (k as { kid?: string }).kid === kid);
  if (!jwk) {
    // A rotated key: fetch again on the next request.
    cache = null;
    throw new AppCheckError("unknown key");
  }
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

/** Throws AppCheckError unless [token] is a valid App Check token for
 * [projectNumber]: RS256, our issuer and audience, not expired. */
export async function verifyAppCheckToken(
  token: string | undefined,
  projectNumber: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  if (!token) throw new AppCheckError("missing");
  const parts = token.split(".");
  if (parts.length !== 3) throw new AppCheckError("malformed");
  const [h, p, s] = parts;
  let header: { alg?: string; kid?: string };
  let payload: {
    iss?: string;
    aud?: string | string[];
    exp?: number;
    iat?: number;
  };
  try {
    header = json(h);
    payload = json(p);
  } catch {
    throw new AppCheckError("malformed");
  }
  if (header.alg !== "RS256" || !header.kid) throw new AppCheckError("alg");
  if (payload.iss !== `https://firebaseappcheck.googleapis.com/${projectNumber}`) {
    throw new AppCheckError("issuer");
  }
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(`projects/${projectNumber}`)) {
    throw new AppCheckError("audience");
  }
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) throw new AppCheckError("expired");
  if ((payload.iat ?? 0) > now + 300) throw new AppCheckError("future");
  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      await keyFor(header.kid, fetchFn),
      bytes(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
  } catch (e) {
    if (e instanceof AppCheckError) throw e;
    throw new AppCheckError("signature");
  }
  if (!ok) throw new AppCheckError("signature");
}

/** Test seam: forget cached keys. */
export const resetJwksCache = () => {
  cache = null;
};
