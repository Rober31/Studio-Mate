import { publicRoute, ok, readJson, clientIp } from "@/server/http";
import { getStudioBySlug } from "@/server/studio";
import { submitRegistration, type RegistrationInput } from "@/server/services/public";
import { rateLimit } from "@/server/ratelimit";
import { AppError, notFound } from "@/server/errors";

export const POST = publicRoute(async (req, { slug }) => {
  const studio = await getStudioBySlug(slug);
  if (!studio || !studio.modules.includes("qr")) throw notFound("הדף");
  if (!rateLimit(`reg:ip:${clientIp(req)}`, 10, 10 * 60_000) || !rateLimit(`reg:studio:${studio.id}`, 200, 60 * 60_000)) {
    throw new AppError("rate_limited", "נשלחו יותר מדי בקשות. נסו שוב בעוד כמה דקות.");
  }
  const body = await readJson<RegistrationInput>(req);
  return ok(await submitRegistration(studio, body), undefined, 201);
});
