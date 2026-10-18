import { staffRoute, ok } from "@/server/http";
import { reportSummary } from "@/server/services/reports";

export const GET = staffRoute((req, ctx) => {
  const d = Number(req.nextUrl.searchParams.get("days"));
  const days = [7, 30, 90].includes(d) ? d : 30;
  return ok(reportSummary(ctx, days));
});
