import { staffRoute, ok } from "@/server/http";
import { auditLog } from "@/server/services/reports";

export const GET = staffRoute((req, ctx) => {
  const sp = req.nextUrl.searchParams;
  return ok(auditLog(ctx, { action: sp.get("action") || undefined, page: Number(sp.get("page")) || 1 }));
});
