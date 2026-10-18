import { staffRoute, ok } from "@/server/http";
import { getSession, roster } from "@/server/services/attendance";

export const GET = staffRoute((_req, ctx, { id }) => {
  const rows = roster(ctx, id);
  return ok({ session: getSession(ctx, id), count: rows.filter((r) => r.status !== "reversed").length, roster: rows });
});
