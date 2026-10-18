import { staffRoute, ok } from "@/server/http";
import { auditLog } from "@/server/services/reports";

export const GET = staffRoute(async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  return ok(await auditLog(ctx, { action: sp.get("action") || undefined, page: Number(sp.get("page")) || 1 }));
});
