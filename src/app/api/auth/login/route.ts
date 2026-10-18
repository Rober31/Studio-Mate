import { publicRoute, ok, readJson, clientIp } from "@/server/http";
import { authenticate, createSession } from "@/server/auth";
import { rateLimit } from "@/server/ratelimit";
import { AppError } from "@/server/errors";

const WINDOW = 15 * 60_000;
const failures = new Map<string, { n: number; until: number }>();

function failedTooOften(key: string, limit: number) {
  const f = failures.get(key);
  return !!f && f.until > Date.now() && f.n >= limit;
}
function recordFailure(key: string) {
  const f = failures.get(key);
  if (!f || f.until <= Date.now()) failures.set(key, { n: 1, until: Date.now() + WINDOW });
  else f.n += 1;
}

export const POST = publicRoute(async (req) => {
  const body = await readJson<{ email?: string; password?: string }>(req);
  const email = (body.email ?? "").trim().toLowerCase();
  const ip = clientIp(req);
  // Overall request cap per IP, plus lockout after repeated failed attempts only.
  if (!rateLimit(`login:${ip}`, 60, WINDOW) || failedTooOften(`ip:${ip}`, 20) || failedTooOften(`email:${email}`, 8)) {
    throw new AppError("rate_limited", "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.");
  }
  if (!email || !body.password) throw new AppError("validation", "כתבו אימייל וסיסמה.");
  let result: { userId: string; studioId: string };
  try {
    result = await authenticate(email, body.password);
  } catch (e) {
    recordFailure(`ip:${ip}`);
    recordFailure(`email:${email}`);
    throw e;
  }
  failures.delete(`email:${email}`);
  await createSession(result.userId, result.studioId);
  return ok({ ok: true });
});
