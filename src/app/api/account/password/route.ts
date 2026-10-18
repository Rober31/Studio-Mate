import { staffRoute, ok, readJson } from "@/server/http";
import { changePassword } from "@/server/services/team";
import { rateLimit } from "@/server/ratelimit";
import { AppError } from "@/server/errors";

export const POST = staffRoute(async (req, ctx) => {
  if (!rateLimit(`pw:${ctx.userId}`, 10, 15 * 60_000)) throw new AppError("rate_limited", "יותר מדי ניסיונות.");
  const body = await readJson<{ current?: string; next?: string }>(req);
  await changePassword(ctx, body.current ?? "", body.next ?? "");
  return ok({ ok: true });
});
