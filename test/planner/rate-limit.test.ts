import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createApp } from "../../src/planner/index";
import { resetJwksCache } from "../../src/planner/appcheck";
import { fakeKv, signAppCheckToken } from "./harness";

describe("rate limit", () => {
  beforeEach(resetJwksCache);

  it("allows the limit, then answers RATE_LIMITED, and never stores raw ids", async () => {
    const { token, jwks } = await signAppCheckToken();
    const fetchFn = (async () => Response.json(jwks)) as unknown as typeof fetch;
    const up = new Hono();
    up.post("/institution/iium", (c) =>
      c.json({ success: true, data: { calendars: [] }, error: null }),
    );
    const app = createApp({ fetchFn, upstream: up });
    const kv = fakeKv();
    const keys: string[] = [];
    const put = kv.put.bind(kv);
    kv.put = async (k, v, o) => {
      keys.push(k);
      return put(k, v, o);
    };
    const env = {
      RATE_LIMIT: kv,
      FIREBASE_PROJECT_NUMBER: "370448245789",
      ALLOWED_ORIGINS: "",
      RATE_LIMIT_PER_HOUR: "2",
    };
    const send = () =>
      app.request(
        "/institution/iium",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Firebase-AppCheck": token,
            "CF-Connecting-IP": "203.0.113.9",
          },
          body: JSON.stringify({ studentId: "2212345", password: "pw" }),
        },
        env,
      );
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const third = await send();
    expect(third.status).toBe(429);
    expect(((await third.json()) as any).error.code).toBe("RATE_LIMITED");
    expect(keys.join(" ")).not.toContain("2212345");
    expect(keys.join(" ")).not.toContain("203.0.113.9");
  });

  it("does not count a request App Check refused", async () => {
    const up = new Hono();
    up.post("/institution/iium", (c) => c.json({ success: true }));
    const kv = fakeKv();
    const keys: string[] = [];
    const put = kv.put.bind(kv);
    kv.put = async (k, v, o) => {
      keys.push(k);
      return put(k, v, o);
    };
    const app = createApp({ upstream: up });
    await app.request(
      "/institution/iium",
      { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } },
      { RATE_LIMIT: kv, FIREBASE_PROJECT_NUMBER: "370448245789", ALLOWED_ORIGINS: "" },
    );
    expect(keys).toHaveLength(0);
  });
});
