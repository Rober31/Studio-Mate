import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth";
import { can } from "@/server/permissions";
import { reportSummary } from "@/server/services/reports";
import { ReportsView } from "@/components/reports/ReportsView";

export const dynamic = "force-dynamic";
export const metadata = { title: "דוחות" };

export default async function ReportsPage() {
  const ctx = await requireCtx();
  if (!can(ctx, "reports")) redirect("/");
  return <ReportsView initial={JSON.parse(JSON.stringify(reportSummary(ctx, 30)))} tz={ctx.studio.timezone} hasAi={ctx.studio.modules.includes("ai")} />;
}
