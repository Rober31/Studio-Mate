import { staffRoute, ok, readJson } from "@/server/http";
import { cancelSession } from "@/server/services/attendance";

export const POST = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<{ reason?: string; version?: number }>(req);
  return ok(cancelSession(ctx, id, body.reason ?? "", Number(body.version)));
});
