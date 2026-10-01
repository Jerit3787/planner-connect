import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createApp } from "../../src/planner/index";
import { resetJwksCache } from "../../src/planner/appcheck";
import { fakeKv, signAppCheckToken } from "./harness";

const env = () => ({
  RATE_LIMIT: fakeKv(),
  FIREBASE_PROJECT_NUMBER: "370448245789",
  ALLOWED_ORIGINS: "https://beta.planner.danplace.tech",
});

/** An upstream stand-in: a portal that fails the way scrapers do. */
function upstream(behaviour: "ok" | "badLogin" | "crash") {
  const app = new Hono();
  app.post("/institution/iium", async (c) => {
    const { password } = (await c.req.json()) as { password: string };
    if (behaviour === "ok") {
      return c.json({
        success: true,
        data: { calendars: [{ title: "S1", schedules: [] }] },
        error: null,
      });
    }
    if (behaviour === "badLogin") {
      return c.json(
        {
          success: false,
          data: null,
          error: { code: "INVALID_CREDENTIALS", message: `Login failed for ${password}` },
        },
        401,
      );
    }
    return c.json(
      {
        success: false,
        data: null,
        error: { code: "INTERNAL_SERVER_ERROR", message: `portal said <b>${password}</b>` },
      },
      500,
    );
  });
  app.get("/institutions", (c) =>
    c.json({ success: true, data: { institutions: [] }, error: null }),
  );
  return app;
}

async function call(
  app: Hono<any>,
  { token, headers = {} }: { token?: string | null; headers?: Record<string, string> } = {},
  path = "/institution/iium",
) {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json");
  if (token) h.set("X-Firebase-AppCheck", token);
  return app.request(
    path,
    {
      method: "POST",
      headers: h,
      body: JSON.stringify({ studentId: "2212345", password: "hunter2-secret" }),
    },
    env(),
  );
}

describe("planner-connect wrapper", () => {
  let token: string;
  let fetchFn: typeof fetch;
  beforeEach(async () => {
    resetJwksCache();
    const signed = await signAppCheckToken();
    token = signed.token;
    fetchFn = (async () => Response.json(signed.jwks)) as unknown as typeof fetch;
  });

  it("refuses an import without App Check", async () => {
    const res = await call(createApp({ fetchFn, upstream: upstream("ok") }), {
      token: null,
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error.code).toBe("APP_CHECK_REQUIRED");
  });

  it("passes a valid import through", async () => {
    const res = await call(createApp({ fetchFn, upstream: upstream("ok") }), { token });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.calendars[0].title).toBe("S1");
  });

  it("never echoes portal text or the password", async () => {
    for (const [b, status, code] of [
      ["badLogin", 401, "INVALID_CREDENTIALS"],
      ["crash", 502, "PORTAL_UNAVAILABLE"],
    ] as const) {
      const res = await call(createApp({ fetchFn, upstream: upstream(b) }), { token });
      const text = await res.text();
      expect(res.status).toBe(status);
      expect(JSON.parse(text).error.code).toBe(code);
      expect(text).not.toContain("hunter2-secret");
      expect(text).not.toContain("<b>");
    }
  });

  it("an unknown university is UNSUPPORTED_INSTITUTION", async () => {
    const res = await call(
      createApp({ fetchFn, upstream: upstream("ok") }),
      { token },
      "/institution/nowhere",
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error.code).toBe("UNSUPPORTED_INSTITUTION");
  });

  it("allows only our web origins", async () => {
    const app = createApp({ fetchFn, upstream: upstream("ok") });
    const ok = await call(app, {
      token,
      headers: { Origin: "https://beta.planner.danplace.tech" },
    });
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://beta.planner.danplace.tech",
    );
    const other = await call(app, {
      token,
      headers: { Origin: "https://evil.example" },
    });
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("the institution list needs no App Check", async () => {
    const app = createApp({ fetchFn, upstream: upstream("ok") });
    const res = await app.request("/institutions", {}, env());
    expect(res.status).toBe(200);
  });

  it("logs nothing from the request body", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
    ];
    await call(createApp({ fetchFn, upstream: upstream("crash") }), { token });
    const logged = spies
      .flatMap((s) => s.mock.calls.flat())
      .map(String)
      .join(" ");
    expect(logged).not.toContain("hunter2-secret");
    expect(logged).not.toContain("2212345");
    spies.forEach((s) => s.mockRestore());
  });
});
