import { cookies } from "next/headers";
import { publicRoute, ok, readJson, clientIp } from "@/server/http";
import { redeemActivation, MEMBER_COOKIE } from "@/server/services/public";
import { rateLimit } from "@/server/ratelimit";
import { AppError } from "@/server/errors";

export const POST = publicRoute(async (req) => {
  if (!rateLimit(`activate:${clientIp(req)}`, 20, 15 * 60_000)) throw new AppError("rate_limited", "יותר מדי ניסיונות. נסו שוב מאוחר יותר.");
  const body = await readJson<{ token?: string }>(req);
  const { sessionToken, expires } = await redeemActivation(body.token ?? "");
  const jar = await cookies();
  jar.set(MEMBER_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expires),
  });
  return ok({ ok: true });
});
