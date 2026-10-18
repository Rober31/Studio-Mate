import { publicRoute, ok, readJson, clientIp } from "@/server/http";
import { acceptInvite } from "@/server/services/team";
import { createSession } from "@/server/auth";
import { rateLimit } from "@/server/ratelimit";
import { AppError } from "@/server/errors";

export const POST = publicRoute(async (req) => {
  if (!rateLimit(`invite:${clientIp(req)}`, 15, 15 * 60_000)) throw new AppError("rate_limited", "יותר מדי ניסיונות.");
  const body = await readJson<{ token?: string; name?: string; password?: string }>(req);
  const { userId, studioId } = acceptInvite(body.token ?? "", body);
  await createSession(userId, studioId);
  return ok({ ok: true });
});
