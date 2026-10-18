import { publicRoute, ok, readJson, clientIp } from "@/server/http";
import { setupStudio } from "@/server/services/team";
import { createSession } from "@/server/auth";
import { rateLimit } from "@/server/ratelimit";
import { AppError } from "@/server/errors";
import type { ModuleKey } from "@/server/studio";

export const POST = publicRoute(async (req) => {
  if (!rateLimit(`setup:${clientIp(req)}`, 10, 15 * 60_000)) throw new AppError("rate_limited", "יותר מדי ניסיונות.");
  const body = await readJson<{ studio_name?: string; owner_name?: string; email?: string; password?: string; timezone?: string; modules?: ModuleKey[] }>(req);
  const { userId, studioId } = setupStudio(body);
  await createSession(userId, studioId);
  return ok({ ok: true });
});
