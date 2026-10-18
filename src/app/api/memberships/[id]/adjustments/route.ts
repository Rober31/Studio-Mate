import { staffRoute, ok, readJson, withIdempotency } from "@/server/http";
import { adjustBalance } from "@/server/services/memberships";

export const POST = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<{ delta?: number; reason?: string }>(req);
  const result = withIdempotency(ctx.studio.id, "balance", req.headers.get("idempotency-key"), { id, ...body }, () => ({
    status: 201,
    data: adjustBalance(ctx, id, Number(body.delta), body.reason ?? ""),
  }));
  return ok(result.data, { replayed: result.replayed }, result.status);
});
