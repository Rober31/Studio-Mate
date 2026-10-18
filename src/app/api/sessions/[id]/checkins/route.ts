import { staffRoute, ok, readJson, withIdempotency } from "@/server/http";
import { manualCheckIn } from "@/server/services/attendance";

export const POST = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<{ contact_id?: string; membership_id?: string | null; no_membership?: boolean; late_reason?: string }>(req);
  const res = withIdempotency(ctx.studio.id, `manual-checkin:${id}`, req.headers.get("idempotency-key"), body, () => ({
    status: 201,
    data: manualCheckIn(ctx, { ...body, session_id: id }),
  }));
  return ok(res.data, undefined, res.status);
});
