import { staffRoute, ok, readJson, withIdempotency } from "@/server/http";
import { adjustBalance } from "@/server/services/memberships";

export const POST = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<{ delta?: number; reason?: string }>(req);
  const result = await withIdempotency(ctx.studio.id, "balance", req.headers.get("idempotency-key"), { id, ...body }, async () => ({
    status: 201,
    data: await adjustBalance(ctx, id, Number(body.delta), body.reason ?? ""),
  }));
  return ok(result.data, { replayed: result.replayed }, result.status);
});
