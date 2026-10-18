import { staffRoute, ok, readJson } from "@/server/http";
import { cancelMembership } from "@/server/services/memberships";

export const POST = staffRoute(async (req, ctx, { id }) => {
  const b = await readJson<{ version?: number; reason?: string }>(req);
  return ok(await cancelMembership(ctx, id, Number(b.version), b.reason ?? ""));
});
