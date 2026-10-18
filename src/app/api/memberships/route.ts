import { staffRoute, ok, readJson, withIdempotency } from "@/server/http";
import { createMembership, listMemberships } from "@/server/services/memberships";
import { assertCan } from "@/server/permissions";

export const GET = staffRoute(async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  const res = await listMemberships(ctx, {
    status: sp.get("status") || undefined,
    q: sp.get("q") || undefined,
    plan: sp.get("plan") || undefined,
    page: Number(sp.get("page") || 1),
  });
  return ok(res.items, { total: res.total, page: Number(sp.get("page") || 1) });
});

export const POST = staffRoute(async (req, ctx) => {
  assertCan(ctx, "memberships.manage");
  const body = await readJson<{ contact_id?: string; plan_id?: string; start_date?: string; end_date?: string | null; sessions?: number | null; reference?: string | null; renewed_from?: string | null }>(req);
  const result = await withIdempotency(ctx.studio.id, "membership", req.headers.get("idempotency-key"), body, async () => ({ status: 201, data: await createMembership(ctx, body) }));
  return ok(result.data, { replayed: result.replayed }, result.status);
});
