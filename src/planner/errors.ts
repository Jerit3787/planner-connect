import type { MiddlewareHandler } from "hono";

/** The only codes and messages this Worker returns on failure. */
export const CODES = {
  APP_CHECK_REQUIRED: [401, "This app could not be verified."],
  INVALID_CREDENTIALS: [401, "The student ID or password was not accepted."],
  VALIDATION_ERROR: [400, "Student ID and password are required."],
  UNSUPPORTED_INSTITUTION: [404, "That university is not supported yet."],
  RATE_LIMITED: [429, "Too many attempts. Try again in an hour."],
  PORTAL_UNAVAILABLE: [502, "The university portal could not be reached."],
} as const;
export type Code = keyof typeof CODES;

export const failure = (code: Code) =>
  Response.json(
    { success: false, data: null, error: { code, message: CODES[code][1] } },
    { status: CODES[code][0] },
  );

/** Upstream codes onto ours. Anything unrecognised is the portal failing. */
const map: Record<string, Code> = {
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  BAD_REQUEST: "VALIDATION_ERROR",
  // Our own, from the App Check and rate-limit middleware, kept as they are.
  APP_CHECK_REQUIRED: "APP_CHECK_REQUIRED",
  RATE_LIMITED: "RATE_LIMITED",
};

/**
 * Rewrites every failure under /institution/* to a fixed code and message.
 * Upstream scrapers put the portal's error text, which can quote what was
 * typed, in `message`; none of it leaves this Worker.
 */
export const sanitiseErrors: MiddlewareHandler = async (c, next) => {
  await next();
  const res = c.res;
  if (res.status < 400) return;
  if (
    res.status === 404 &&
    !res.headers.get("Content-Type")?.includes("json")
  ) {
    c.res = failure("UNSUPPORTED_INSTITUTION");
    return;
  }
  let code: Code = "PORTAL_UNAVAILABLE";
  try {
    const body = (await res.clone().json()) as { error?: { code?: string } };
    code = map[body?.error?.code ?? ""] ?? code;
  } catch {
    // Not JSON: the portal failing.
  }
  c.res = failure(code);
};
