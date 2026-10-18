import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth";
import { can } from "@/server/permissions";
import { listImports, IMPORT_FIELDS } from "@/server/services/imports";
import { all } from "@/server/db";
import { ImportsView } from "@/components/imports/ImportsView";

export const dynamic = "force-dynamic";
export const metadata = { title: "ייבוא וחיבורים" };

export default async function ImportsPage() {
  const ctx = await requireCtx();
  if (!can(ctx, "imports")) redirect("/");
  const connections = all<{ provider: string; name: string; status: string; last_success_at: string | null; freshness_hours: number; last_error: string | null }>(
    "SELECT provider, name, status, last_success_at, freshness_hours, last_error FROM integration_connections WHERE studio_id = ? ORDER BY provider",
    ctx.studio.id,
  );
  return (
    <ImportsView
      history={listImports(ctx)}
      connections={connections}
      fields={[...IMPORT_FIELDS]}
      canExport={can(ctx, "export")}
      freshnessHours={ctx.studio.settings.importFreshnessHours}
      tz={ctx.studio.timezone}
    />
  );
}
