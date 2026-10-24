// Read-only aggregates for the Today dashboard widgets. No new business rules:
// everything comes from existing tasks, sessions, registrations and interaction events.

import { one } from "../db";
import { can, hasModule, type Ctx } from "../permissions";
import { addLocalDays, localDate, startOfLocalDay } from "../time";
import { listSessions } from "./attendance";
import { listRegistrations } from "./public";
import { listTasks, taskCounts } from "./tasks";

export type DashboardData = {
  doneToday: number;
  tasks: { today: number; overdue: number; items: { id: string; contact_id: string; contact_name: string; title: string | null; reason_code: string; due_at: string; status: string; assignee_name: string | null }[] };
  week: { start: string; days: string[]; sessions: { id: string; title: string; start_at: string; end_at: string; status: string; trainer_name: string | null; attendance_count: number }[] } | null;
  registrations: { count: number; latest: { id: string; name: string; interest: string | null; created_at: string; contact_id: string | null }[] } | null;
  canImport: boolean;
  canReports: boolean;
};

export async function dashboardData(ctx: Ctx): Promise<DashboardData> {
  const tz = ctx.studio.timezone;
  const today = localDate(new Date(), tz);
  const todayStart = startOfLocalDay(today, tz).toISOString();
  // Week starts on Sunday (Israeli work week).
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const weekStart = addLocalDays(today, -dow);
  const days = Array.from({ length: 7 }, (_, i) => addLocalDays(weekStart, i));

  const showWeek = hasModule(ctx, "qr") && can(ctx, "attendance.record");
  const showRegs = can(ctx, "registrations.review");

  const [done, counts, todayTasks, overdueTasks, sessions, regs] = await Promise.all([
    one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM interaction_events WHERE studio_id = ? AND event_type = 'outcome_recorded' AND occurred_at >= ?",
      ctx.studio.id,
      todayStart,
    ),
    taskCounts(ctx),
    listTasks(ctx, "today", false),
    listTasks(ctx, "overdue", false),
    showWeek ? listSessions(ctx, startOfLocalDay(weekStart, tz).toISOString(), startOfLocalDay(addLocalDays(weekStart, 7), tz).toISOString()) : Promise.resolve(null),
    showRegs ? listRegistrations(ctx, "new") : Promise.resolve(null),
  ]);

  return {
    doneToday: done?.n ?? 0,
    tasks: {
      today: counts.today,
      overdue: counts.overdue,
      items: [...overdueTasks, ...todayTasks].slice(0, 5).map((t) => ({
        id: t.id,
        contact_id: t.contact_id,
        contact_name: t.contact_name,
        title: t.title,
        reason_code: t.reason_code,
        due_at: t.due_at,
        status: t.status,
        assignee_name: t.assignee_name,
      })),
    },
    week: sessions
      ? {
          start: weekStart,
          days,
          sessions: sessions.map((s) => ({ id: s.id, title: s.title, start_at: s.start_at, end_at: s.end_at, status: s.status, trainer_name: s.trainer_name, attendance_count: s.attendance_count })),
        }
      : null,
    registrations: regs ? { count: regs.length, latest: regs.slice(0, 4).map((r) => ({ id: r.id, name: r.name, interest: r.interest, created_at: r.created_at, contact_id: r.contact_id })) } : null,
    canImport: can(ctx, "imports"),
    canReports: can(ctx, "reports"),
  };
}
