import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";
import { failure } from "./errors";

const sha = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/**
 * At most RATE_LIMIT_PER_HOUR imports an hour per network address and per
 * student ID, so this Worker cannot be used to guess portal passwords. Keys
 * are hashes, never the raw address or ID. KV is eventually consistent:
 * this is a brake, not an exact counter.
 */
export const rateLimit =
  (): MiddlewareHandler<{ Bindings: Env }> => async (c, next) => {
    if (c.req.method !== "POST") return next();
    const limit = Number(c.env.RATE_LIMIT_PER_HOUR ?? "10");
    const hour = Math.floor(Date.now() / 3_600_000);
    let studentId = "";
    try {
      const body = (await c.req.json()) as { studentId?: unknown };
      studentId = String(body.studentId ?? "");
    } catch {
      // Upstream validates the body and answers VALIDATION_ERROR.
    }
    const institution = c.req.path.split("/")[2] ?? "";
    const keys = [
      `rl:ip:${await sha(c.req.header("CF-Connecting-IP") ?? "unknown")}:${hour}`,
      `rl:id:${await sha(`${institution}:${studentId}`)}:${hour}`,
    ];
    const counts = await Promise.all(
      keys.map(async (k) => Number((await c.env.RATE_LIMIT.get(k)) ?? "0")),
    );
    if (counts.some((n) => n >= limit)) return failure("RATE_LIMITED");
    await Promise.all(
      keys.map((k, i) =>
        c.env.RATE_LIMIT.put(k, String(counts[i] + 1), { expirationTtl: 3700 }),
      ),
    );
    return next();
  };
