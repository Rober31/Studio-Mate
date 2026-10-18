import { staffRoute, ok } from "@/server/http";
import { getSession, roster } from "@/server/services/attendance";

export const GET = staffRoute(async (_req, ctx, { id }) => {
  const rows = await roster(ctx, id);
  return ok({ session: await getSession(ctx, id), count: rows.filter((r) => r.status !== "reversed").length, roster: rows });
});
