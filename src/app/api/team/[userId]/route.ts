import { staffRoute, ok, readJson } from "@/server/http";
import { updateMember } from "@/server/services/team";
import type { Role } from "@/server/permissions";

export const PATCH = staffRoute(async (req, ctx, { userId }) => {
  const body = await readJson<{ role?: Role; scope?: "all" | "assigned"; active?: boolean }>(req);
  await updateMember(ctx, userId, body);
  return ok({ ok: true });
});
