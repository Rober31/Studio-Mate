import { publicRoute, ok, readJson, clientIp } from "@/server/http";
import { authenticate, createSession } from "@/server/auth";
import { rateLimit } from "@/server/ratelimit";
import { AppError } from "@/server/errors";

export const POST = publicRoute(async (req) => {
  const body = await readJson<{ email?: string; password?: string }>(req);
  const email = (body.email ?? "").trim().toLowerCase();
  if (!rateLimit(`login:${clientIp(req)}`, 20, 15 * 60_000) || !rateLimit(`login:${email}`, 8, 15 * 60_000)) {
    throw new AppError("rate_limited", "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.");
  }
  if (!email || !body.password) throw new AppError("validation", "כתבו אימייל וסיסמה.");
  const { userId, studioId } = authenticate(email, body.password);
  await createSession(userId, studioId);
  return ok({ ok: true });
});
