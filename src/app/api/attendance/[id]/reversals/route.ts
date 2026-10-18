import { staffRoute, ok, readJson } from "@/server/http";
import { reverseAttendance } from "@/server/services/attendance";

export const POST = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<{ reason?: string; version?: number }>(req);
  return ok(await reverseAttendance(ctx, id, body.reason ?? "", body.version));
});
