import { staffRoute, ok } from "@/server/http";
import { memberDevices, revokeMemberDevices } from "@/server/services/public";
import { assertCan } from "@/server/permissions";

export const GET = staffRoute(async (_req, ctx, { id }) => ok(await memberDevices(ctx, id)));

export const DELETE = staffRoute(async (_req, ctx, { id }) => {
  assertCan(ctx, "contacts.edit");
  await revokeMemberDevices(ctx, id);
  return ok({ ok: true });
});
