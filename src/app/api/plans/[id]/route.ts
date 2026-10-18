import { staffRoute, ok, readJson } from "@/server/http";
import { savePlan, type PlanType } from "@/server/services/memberships";
import { one } from "@/server/db";

export const PATCH = staffRoute(async (req, ctx, { id }) => {
  const b = await readJson<{ name?: string; type?: PlanType; sessions_granted?: number | null; validity_days?: number | null; price?: string | null; active?: boolean }>(req);
  await savePlan(ctx, { ...b, id });
  return ok(await one("SELECT * FROM plans WHERE id = ? AND studio_id = ?", id, ctx.studio.id));
});
