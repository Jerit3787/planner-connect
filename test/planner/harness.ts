/** In-memory KV with the subset the rate limiter uses. */
export function fakeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => void store.set(key, value),
    delete: async (key: string) => void store.delete(key),
  } as unknown as KVNamespace;
}

const enc = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString("base64url");

/** A real RS256 App Check token and the JWKS that verifies it. */
export async function signAppCheckToken(
  claims: Record<string, unknown> = {},
  projectNumber = "370448245789",
) {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = {
    ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
    kid: "k1",
    alg: "RS256",
    use: "sig",
  };
  const now = Math.floor(Date.now() / 1000);
  const header = enc({ alg: "RS256", kid: "k1", typ: "JWT" });
  const payload = enc({
    iss: `https://firebaseappcheck.googleapis.com/${projectNumber}`,
    aud: [`projects/${projectNumber}`],
    sub: "1:370448245789:ios:abc",
    iat: now,
    exp: now + 3600,
    ...claims,
  });
  const sig = Buffer.from(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      pair.privateKey,
      new TextEncoder().encode(`${header}.${payload}`),
    ),
  ).toString("base64url");
  return { token: `${header}.${payload}.${sig}`, jwks: { keys: [jwk] } };
}
