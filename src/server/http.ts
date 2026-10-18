import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { AppError } from "./errors";
import { loadSession, SESSION_COOKIE } from "./auth";
import type { Ctx } from "./permissions";
import { one, run } from "./db";
import { hashObject, nowIso, token } from "./util";

type Params = Record<string, string>;
type RouteContext = { params: Promise<Params> };

/** Rejects Promises at compile time so a missing `await` can never serialize as {}. */
type NotPromise<T> = T extends PromiseLike<unknown> ? never : T;

export function ok<T>(data: NotPromise<T>, meta?: Record<string, unknown>, status = 200) {
  return NextResponse.json(meta ? { data, meta } : { data }, { status });
}

export function errorResponse(err: unknown) {
  const requestId = token(8);
  if (err instanceof AppError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, fields: err.fields, details: err.details, request_id: requestId } },
      { status: err.status },
    );
  }
  console.error(`[${requestId}]`, err);
  return NextResponse.json(
    { error: { code: "unavailable", message: "משהו השתבש. נסו שוב בעוד רגע.", request_id: requestId } },
    { status: 500 },
  );
}

/** Rejects cross-site state-changing requests (SEC: CSRF). */
function checkCsrf(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  if (req.headers.get("x-sm-request") !== "1") throw new AppError("forbidden", "הבקשה נחסמה מטעמי אבטחה.");
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (host && new URL(origin).host !== host) throw new AppError("forbidden", "הבקשה נחסמה מטעמי אבטחה.");
  }
}

export async function readJson<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  try {
    const text = await req.text();
    if (text.length > 2_000_000) throw new AppError("validation", "הבקשה גדולה מדי.");
    return (text ? JSON.parse(text) : {}) as T;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("validation", "תוכן הבקשה אינו תקין.");
  }
}

/** Authenticated staff route. The studio always comes from the session, never from the client. */
export function staffRoute(handler: (req: NextRequest, ctx: Ctx, params: Params) => Promise<Response> | Response) {
  return async (req: NextRequest, rc: RouteContext) => {
    try {
      checkCsrf(req);
      const jar = await cookies();
      const ctx = await loadSession(jar.get(SESSION_COOKIE)?.value);
      if (!ctx) throw new AppError("unauthenticated", "צריך להתחבר מחדש.");
      return await handler(req, ctx, await rc.params);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Unauthenticated route (public pages, login). */
export function publicRoute(handler: (req: NextRequest, params: Params) => Promise<Response> | Response) {
  return async (req: NextRequest, rc: RouteContext) => {
    try {
      checkCsrf(req);
      return await handler(req, await rc.params);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function clientIp(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
}

/**
 * Idempotency-Key handling (API-01): same key + same body returns the stored
 * response; same key + different body is a conflict.
 */
export async function withIdempotency<T>(
  studioId: string,
  scope: string,
  key: string | null,
  body: unknown,
  fn: () => Promise<{ status: number; data: T }>,
): Promise<{ status: number; data: T; replayed: boolean }> {
  if (!key) return { ...(await fn()), replayed: false };
  if (key.length > 200) throw new AppError("validation", "מפתח הבקשה ארוך מדי.");
  const requestHash = hashObject(body);
  const existing = await one<{ request_hash: string; response: string; status: number }>(
    "SELECT request_hash, response, status FROM idempotency_keys WHERE studio_id = ? AND scope = ? AND key = ?",
    studioId,
    scope,
    key,
  );
  if (existing) {
    if (existing.request_hash !== requestHash) throw new AppError("conflict", "הבקשה כבר נשלחה עם תוכן אחר.");
    return { status: existing.status, data: JSON.parse(existing.response) as T, replayed: true };
  }
  const result = await fn();
  await run(
    "INSERT OR IGNORE INTO idempotency_keys (studio_id, scope, key, request_hash, response, status, created_at) VALUES (?,?,?,?,?,?,?)",
    studioId,
    scope,
    key,
    requestHash,
    JSON.stringify(result.data),
    result.status,
    nowIso(),
  );
  return { ...result, replayed: false };
}
