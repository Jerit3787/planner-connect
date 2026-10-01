import { beforeEach, describe, expect, it } from "vitest";
import {
  AppCheckError,
  resetJwksCache,
  verifyAppCheckToken,
} from "../../src/planner/appcheck";
import { signAppCheckToken } from "./harness";

const jwksFetch = (jwks: unknown) =>
  (async () => Response.json(jwks)) as unknown as typeof fetch;

describe("verifyAppCheckToken", () => {
  beforeEach(resetJwksCache);

  it("accepts a valid token for our project", async () => {
    const { token, jwks } = await signAppCheckToken();
    await expect(
      verifyAppCheckToken(token, "370448245789", jwksFetch(jwks)),
    ).resolves.toBeUndefined();
  });

  it("refuses a missing, malformed, expired or wrong-project token", async () => {
    const { jwks } = await signAppCheckToken();
    const expired = await signAppCheckToken({ exp: 1 });
    const other = await signAppCheckToken({}, "111");
    for (const [token, keys] of [
      [undefined, jwks],
      ["not.a.jwt.at.all", jwks],
      [expired.token, expired.jwks],
      [other.token, other.jwks],
    ] as const) {
      resetJwksCache();
      await expect(
        verifyAppCheckToken(
          token as string | undefined,
          "370448245789",
          jwksFetch(keys),
        ),
      ).rejects.toBeInstanceOf(AppCheckError);
    }
  });

  it("refuses a token signed by a different key", async () => {
    const a = await signAppCheckToken();
    const b = await signAppCheckToken();
    await expect(
      verifyAppCheckToken(a.token, "370448245789", jwksFetch(b.jwks)),
    ).rejects.toBeInstanceOf(AppCheckError);
  });
});
