import { staffRoute, ok, readJson } from "@/server/http";
import { pauseMembership } from "@/server/services/memberships";

export const POST = staffRoute(async (req, ctx, { id }) => {
  const b = await readJson<{ start_date?: string; end_date?: string; reason?: string; extend?: boolean }>(req);
  return ok(pauseMembership(ctx, id, b.start_date ?? "", b.end_date ?? "", b.reason ?? "", !!b.extend));
});
