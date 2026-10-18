import { requireCtx, userStudios } from "@/server/auth";
import { buildNav } from "@/server/nav";
import { AppShell } from "@/components/AppShell";
import { ROLE_LABEL } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const nav = buildNav(ctx);
  const studios = userStudios(ctx.userId);
  return (
    <AppShell
      nav={nav}
      user={{ name: ctx.name, email: ctx.email, role: ROLE_LABEL[ctx.role] }}
      studio={{ id: ctx.studio.id, name: ctx.studio.name }}
      studios={studios.map((s) => ({ id: s.id, name: s.name }))}
    >
      {children}
    </AppShell>
  );
}
