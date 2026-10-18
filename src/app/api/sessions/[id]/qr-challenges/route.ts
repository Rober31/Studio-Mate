import { staffRoute, ok } from "@/server/http";
import { issueChallenge } from "@/server/services/attendance";
import { rateLimit } from "@/server/ratelimit";
import { AppError } from "@/server/errors";

export const POST = staffRoute((_req, ctx, { id }) => {
  if (!rateLimit(`qr:${ctx.sessionId}`, 120, 10 * 60_000)) throw new AppError("rate_limited", "יותר מדי בקשות לקוד. חכו רגע.");
  const c = issueChallenge(ctx, id);
  return ok({ ...c, slug: ctx.studio.slug }, undefined, 201);
});
