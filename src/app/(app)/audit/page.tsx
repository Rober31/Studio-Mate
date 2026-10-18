import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth";
import { can } from "@/server/permissions";
import { auditLog, opsHealth } from "@/server/services/reports";
import { AuditView } from "@/components/audit/AuditView";

export const dynamic = "force-dynamic";
export const metadata = { title: "יומן ותפעול" };

export default async function AuditPage() {
  const ctx = await requireCtx();
  if (!can(ctx, "audit")) redirect("/");
  return <AuditView initial={await auditLog(ctx, {})} health={await opsHealth(ctx)} tz={ctx.studio.timezone} quota={ctx.studio.settings.aiMonthlyQuota} />;
}
