import { staffRoute, ok, readJson } from "@/server/http";
import { getSession, roster, saveSession } from "@/server/services/attendance";

export const GET = staffRoute((_req, ctx, { id }) => ok({ session: getSession(ctx, id), roster: roster(ctx, id) }));

export const PATCH = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<{ title?: string; date?: string; start?: string; end?: string; trainer_id?: string | null; version?: number; change_reason?: string }>(req);
  return ok(saveSession(ctx, { ...body, id }));
});
