import { publicRoute, ok, readJson, clientIp } from "@/server/http";
import { resetPassword } from "@/server/services/team";
import { rateLimit } from "@/server/ratelimit";
import { AppError } from "@/server/errors";

export const POST = publicRoute(async (req) => {
  if (!rateLimit(`reset:${clientIp(req)}`, 15, 15 * 60_000)) throw new AppError("rate_limited", "יותר מדי ניסיונות.");
  const body = await readJson<{ token?: string; password?: string }>(req);
  resetPassword(body.token ?? "", body.password ?? "");
  return ok({ ok: true });
});
