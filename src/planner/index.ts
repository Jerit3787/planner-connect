import { Hono } from "hono";
import { cors } from "hono/cors";
import upstreamApp from "../index";
import type { Env } from "./env";
import { verifyAppCheckToken } from "./appcheck";
import { failure, sanitiseErrors } from "./errors";

/**
 * planner-connect: upstream fyutr-connect, unchanged, behind our checks.
 * See PLANNER.md. Upstream merges touch src/institution/** only.
 */
export function createApp(
  deps: { fetchFn?: typeof fetch; upstream?: Hono<any> } = {},
) {
  const app = new Hono<{ Bindings: Env }>();

  // Only our web app's origins; native apps send no Origin at all.
  app.use("*", (c, next) =>
    cors({
      origin: (origin) =>
        (c.env.ALLOWED_ORIGINS ?? "")
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean)
          .includes(origin)
          ? origin
          : null,
      allowHeaders: ["Content-Type", "X-Firebase-AppCheck"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      maxAge: 600,
    })(c, next),
  );

  app.use("/institution/*", sanitiseErrors);
  app.use("/institution/*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    try {
      await verifyAppCheckToken(
        c.req.header("X-Firebase-AppCheck"),
        c.env.FIREBASE_PROJECT_NUMBER,
        deps.fetchFn,
      );
    } catch {
      return failure("APP_CHECK_REQUIRED");
    }
    return next();
  });

  app.route("/", deps.upstream ?? upstreamApp);
  return app;
}

export default createApp();
