import { can, hasModule, type Ctx } from "./permissions";
import { one } from "./db";
import { localDate, startOfLocalDay } from "./time";

export type NavItem = { href: string; label: string; icon: string; count?: number; primary?: boolean; section?: string };

export function buildNav(ctx: Ctx): NavItem[] {
  const items: NavItem[] = [];
  const sid = ctx.studio.id;
  if (can(ctx, "contacts.view")) {
    const overdue = one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM tasks t JOIN contacts c ON c.id = t.contact_id WHERE t.studio_id = ? AND t.status IN ('open','in_progress') AND t.due_at < ? AND c.merged_into IS NULL",
      sid,
      startOfLocalDay(localDate(new Date(), ctx.studio.timezone), ctx.studio.timezone).toISOString(),
    )!.n;
    items.push({ href: "/today", label: "היום", icon: "today", primary: true });
    items.push({ href: "/contacts", label: "לקוחות", icon: "people", primary: true });
    items.push({ href: "/tasks", label: "משימות", icon: "tasks", primary: true, count: overdue || undefined });
  }
  if (can(ctx, "memberships.view")) items.push({ href: "/memberships", label: "מנויים", icon: "card" });
  if (hasModule(ctx, "qr") && can(ctx, "attendance.record")) items.push({ href: "/sessions", label: "שיעורים ונוכחות", icon: "calendar", primary: true });
  if (can(ctx, "registrations.review")) {
    const n = one<{ n: number }>("SELECT COUNT(*) AS n FROM registrations WHERE studio_id = ? AND status = 'new'", sid)!.n;
    items.push({ href: "/registrations", label: "בקשות הרשמה", icon: "qr", count: n || undefined });
  }
  if (can(ctx, "reports")) items.push({ href: "/reports", label: "דוחות", icon: "chart", section: "manage" });
  if (can(ctx, "imports")) items.push({ href: "/imports", label: "ייבוא וחיבורים", icon: "upload", section: "manage" });
  items.push({ href: "/settings", label: can(ctx, "settings") ? "הגדרות" : "החשבון שלי", icon: "settings", section: "manage" });
  if (can(ctx, "audit")) items.push({ href: "/audit", label: "יומן ותפעול", icon: "shield", section: "manage" });
  return items;
}

export function homePath(ctx: Ctx): string {
  if (can(ctx, "contacts.view")) return "/today";
  if (hasModule(ctx, "qr") && can(ctx, "attendance.record")) return "/sessions";
  return "/settings";
}
