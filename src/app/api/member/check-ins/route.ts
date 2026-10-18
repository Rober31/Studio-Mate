import { cookies } from "next/headers";
import { publicRoute, ok, readJson, clientIp, withIdempotency } from "@/server/http";
import { getStudioBySlug } from "@/server/studio";
import { memberFromToken, MEMBER_COOKIE } from "@/server/services/public";
import { memberCheckIn } from "@/server/services/attendance";
import { rateLimit } from "@/server/ratelimit";
import { AppError, notFound } from "@/server/errors";

// Identity comes from the member session; the class from the challenge token (QR-API).
export const POST = publicRoute(async (req) => {
  if (!rateLimit(`checkin:${clientIp(req)}`, 30, 5 * 60_000)) throw new AppError("rate_limited", "יותר מדי ניסיונות. חכו רגע ונסו שוב.");
  const body = await readJson<{ challenge_token?: string; slug?: string }>(req);
  const studio = await getStudioBySlug(body.slug ?? "");
  if (!studio || !studio.modules.includes("qr")) throw notFound("הסטודיו");
  const jar = await cookies();
  const member = await memberFromToken(jar.get(MEMBER_COOKIE)?.value, studio.id);
  if (!member) throw new AppError("unauthenticated", "צריך לחבר את הטלפון פעם אחת. בקשו קישור בקבלה.", { details: { reason: "no_member_session" } });
  const res = await withIdempotency(studio.id, `checkin:${member.contactId}`, req.headers.get("idempotency-key"), { t: body.challenge_token }, async () => ({
    status: 200,
    data: await memberCheckIn(studio, member.contactId, body.challenge_token ?? ""),
  }));
  return ok({ ...res.data, first_name: member.firstName }, undefined, res.status);
});
