import { staffRoute, ok, readJson } from "@/server/http";
import { getSession, roster, saveSession } from "@/server/services/attendance";

export const GET = staffRoute(async (_req, ctx, { id }) => ok({ session: await getSession(ctx, id), roster: await roster(ctx, id) }));

export const PATCH = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<{ title?: string; date?: string; start?: string; end?: string; trainer_id?: string | null; version?: number; change_reason?: string }>(req);
  return ok(await saveSession(ctx, { ...body, id }));
});
