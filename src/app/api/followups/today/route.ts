import { staffRoute, ok } from "@/server/http";
import { todayList, type TodayFilters } from "@/server/services/followups";

export const GET = staffRoute((req, ctx) => {
  const sp = req.nextUrl.searchParams;
  const filters: TodayFilters = {
    owner: sp.get("owner") || undefined,
    rule: sp.get("rule") || undefined,
    priority: (sp.get("priority") as TodayFilters["priority"]) || undefined,
    due: (sp.get("due") as TodayFilters["due"]) || undefined,
    source: sp.get("source") || undefined,
  };
  const data = todayList(ctx, filters);
  return ok(data, { source_updated_at: data.evaluatedAt });
});
