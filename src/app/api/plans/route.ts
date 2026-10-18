import { staffRoute, ok, readJson } from "@/server/http";
import { listPlans, savePlan, type PlanType } from "@/server/services/memberships";
import { assertCan } from "@/server/permissions";
import { one } from "@/server/db";

export const GET = staffRoute((req, ctx) => {
  assertCan(ctx, "memberships.view");
  return ok(listPlans(ctx.studio.id, req.nextUrl.searchParams.get("all") === "1"));
});

export const POST = staffRoute(async (req, ctx) => {
  const b = await readJson<{ name?: string; type?: PlanType; sessions_granted?: number | null; validity_days?: number | null; price?: string | null }>(req);
  const planId = savePlan(ctx, b);
  return ok(one("SELECT * FROM plans WHERE id = ?", planId), undefined, 201);
});
