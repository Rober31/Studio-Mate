import { staffRoute, ok } from "@/server/http";
import { memberDevices, revokeMemberDevices } from "@/server/services/public";
import { assertCan } from "@/server/permissions";

export const GET = staffRoute((_req, ctx, { id }) => ok(memberDevices(ctx, id)));

export const DELETE = staffRoute((_req, ctx, { id }) => {
  assertCan(ctx, "contacts.edit");
  revokeMemberDevices(ctx, id);
  return ok({ ok: true });
});
