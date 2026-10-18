import { staffRoute, ok } from "@/server/http";
import { revokeInvite } from "@/server/services/team";

export const DELETE = staffRoute((_req, ctx, { id }) => {
  revokeInvite(ctx, id);
  return ok({ ok: true });
});
