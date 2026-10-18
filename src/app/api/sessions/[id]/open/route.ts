import { staffRoute, ok, readJson } from "@/server/http";
import { setSessionOpen } from "@/server/services/attendance";

export const POST = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<{ open?: boolean }>(req);
  return ok(setSessionOpen(ctx, id, body.open !== false));
});
