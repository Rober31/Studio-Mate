import { requireCtx } from "@/server/auth";
import { can } from "@/server/permissions";
import { listTeam } from "@/server/services/team";
import { templateDraft } from "@/server/services/ai";
import type { Facts } from "@/server/services/followups";
import { SettingsView, type SettingsTab } from "@/components/settings/SettingsView";
import { ROLE_LABEL } from "@/lib/i18n";

export const dynamic = "force-dynamic";
export const metadata = { title: "הגדרות" };

const SAMPLE: Record<string, Facts> = {
  R01: { rule: "R01", first_name: "נועה", language: "he" },
  R02: { rule: "R02", first_name: "נועה", language: "he", trial_date: "2026-10-14" },
  R03: { rule: "R03", first_name: "נועה", language: "he", plan_name: "מנוי חודשי", end_date: "2026-10-25", days_left: 4 },
  R04: { rule: "R04", first_name: "נועה", language: "he", plan_name: "כרטיסייה 10", balance: 2 },
  R05: { rule: "R05", first_name: "נועה", language: "he", plan_name: "מנוי חודשי", days_since_attendance: 16 },
  R06: { rule: "R06", first_name: "נועה", language: "he" },
  R07: { rule: "R07", first_name: "נועה", language: "he", plan_name: "מנוי חודשי", ended_date: "2026-10-10" },
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const canSettings = can(ctx, "settings");
  const canUsers = can(ctx, "users");
  const tabs: SettingsTab[] = [
    ...(canSettings ? (["studio"] as SettingsTab[]) : []),
    ...(canUsers ? (["team"] as SettingsTab[]) : []),
    ...(canSettings ? (["rules", "messages"] as SettingsTab[]) : []),
    ...(canSettings && ctx.studio.modules.includes("qr") ? (["qr"] as SettingsTab[]) : []),
    "account",
  ];
  const tab = tabs.includes(sp.tab as SettingsTab) ? (sp.tab as SettingsTab) : tabs[0];
  const s = ctx.studio;
  const templates = canSettings
    ? Object.entries(SAMPLE).map(([rule, facts]) => ({ rule, text: templateDraft(facts, rule, s.settings.messageLanguage, s.settings.signature).text }))
    : [];
  return (
    <SettingsView
      tabs={tabs}
      initialTab={tab}
      studio={canSettings ? { name: s.name, slug: s.slug, timezone: s.timezone, modules: s.modules, settings: s.settings } : null}
      team={canUsers ? listTeam(ctx) : null}
      me={{ id: ctx.userId, name: ctx.name, email: ctx.email, role: ROLE_LABEL[ctx.role] }}
      aiConfigured={!!process.env.ANTHROPIC_API_KEY}
      templates={templates}
    />
  );
}
