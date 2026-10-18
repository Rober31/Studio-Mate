import { staffRoute, ok, readJson } from "@/server/http";
import { inviteStaff } from "@/server/services/team";
import type { Role } from "@/server/permissions";

export const POST = staffRoute(async (req, ctx) => {
  const body = await readJson<{ email?: string; name?: string; role?: Role; scope?: "all" | "assigned" }>(req);
  return ok(await inviteStaff(ctx, body), undefined, 201);
});
