import type { Studio, ModuleKey } from "./studio";
import { AppError } from "./errors";

export type Role = "owner" | "staff" | "instructor";

export type Ctx = {
  userId: string;
  name: string;
  email: string;
  role: Role;
  scope: "all" | "assigned";
  studio: Studio;
  sessionId: string;
};

export type Action =
  | "contacts.view"
  | "contacts.edit"
  | "contacts.merge"
  | "followup.use"
  | "memberships.view"
  | "memberships.manage"
  | "balance.adjust"
  | "attendance.record"
  | "attendance.correct"
  | "sessions.manage"
  | "registrations.review"
  | "imports"
  | "export"
  | "reports"
  | "settings"
  | "users"
  | "audit";

// Derived from the Users & Permissions table (spec §06). Deny by default.
const MATRIX: Record<Role, Action[]> = {
  owner: [
    "contacts.view",
    "contacts.edit",
    "contacts.merge",
    "followup.use",
    "memberships.view",
    "memberships.manage",
    "balance.adjust",
    "attendance.record",
    "attendance.correct",
    "sessions.manage",
    "registrations.review",
    "imports",
    "export",
    "reports",
    "settings",
    "users",
    "audit",
  ],
  staff: [
    "contacts.view",
    "contacts.edit",
    "followup.use",
    "memberships.view",
    "attendance.record",
    "attendance.correct",
    "sessions.manage",
    "registrations.review",
  ],
  instructor: ["attendance.record"],
};

const ACTION_MODULE: Partial<Record<Action, ModuleKey>> = {
  "followup.use": "ai",
  "attendance.record": "qr",
  "attendance.correct": "qr",
  "sessions.manage": "qr",
  "registrations.review": "qr",
};

export function can(ctx: Ctx, action: Action): boolean {
  const mod = ACTION_MODULE[action];
  if (mod && !ctx.studio.modules.includes(mod)) return false;
  return MATRIX[ctx.role].includes(action);
}

export function hasModule(ctx: Ctx, mod: ModuleKey): boolean {
  return ctx.studio.modules.includes(mod);
}

export function assertCan(ctx: Ctx, action: Action): void {
  if (!can(ctx, action)) throw new AppError("forbidden", "אין לך הרשאה לפעולה הזו.");
}

/** SQL fragment restricting contacts to the user's scope (alias c). */
export function contactScopeSql(ctx: Ctx): { sql: string; params: unknown[] } {
  if (ctx.role === "owner" || ctx.scope === "all") return { sql: "1=1", params: [] };
  return {
    sql: "(c.owner_id = ? OR EXISTS (SELECT 1 FROM tasks t WHERE t.contact_id = c.id AND t.assignee_id = ? AND t.status IN ('open','in_progress','snoozed')))",
    params: [ctx.userId, ctx.userId],
  };
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: "בעלים",
  staff: "עובד/ת מעקב",
  instructor: "מדריך/ה או קבלה",
};
