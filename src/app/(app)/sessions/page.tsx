import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth";
import { can, hasModule } from "@/server/permissions";
import { listSessions } from "@/server/services/attendance";
import { staffList } from "@/server/services/contacts";
import { localDate, startOfLocalDay, addLocalDays } from "@/server/time";
import { SessionsView } from "@/components/sessions/SessionsView";

export const dynamic = "force-dynamic";
export const metadata = { title: "שיעורים ונוכחות" };

export default async function SessionsPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const ctx = await requireCtx();
  if (!hasModule(ctx, "qr") || !can(ctx, "attendance.record")) redirect("/");
  const tz = ctx.studio.timezone;
  const { week } = await searchParams;
  const today = localDate(new Date(), tz);
  const anchor = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : today;
  const dow = new Date(`${anchor}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  const weekStart = addLocalDays(anchor, -dow);
  const from = startOfLocalDay(weekStart, tz).toISOString();
  const to = startOfLocalDay(addLocalDays(weekStart, 7), tz).toISOString();
  const sessions = await listSessions(ctx, from, to);
  return (
    <SessionsView
      sessions={JSON.parse(JSON.stringify(sessions))}
      weekStart={weekStart}
      today={today}
      tz={tz}
      staff={await staffList(ctx.studio.id)}
      canManage={can(ctx, "sessions.manage")}
      canExport={can(ctx, "export") || can(ctx, "attendance.correct")}
      range={{ from, to }}
    />
  );
}
