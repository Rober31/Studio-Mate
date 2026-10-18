import { staffRoute, ok } from "@/server/http";
import { revokeInvite } from "@/server/services/team";

export const DELETE = staffRoute(async (_req, ctx, { id }) => {
  await revokeInvite(ctx, id);
  return ok({ ok: true });
});
