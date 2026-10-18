// Reports & pilot measurement (spec §37). Counters keep WA-opened and
// marked-sent separate, and renewals are "linked in time", not attributed.

import { all, one } from "../db";
import { assertCan, type Ctx } from "../permissions";
import { addDays, nowIso } from "../util";
import { todayList } from "./followups";

export function reportSummary(ctx: Ctx, days: number) {
  assertCan(ctx, "reports");
  const sid = ctx.studio.id;
  const to = nowIso();
  const from = addDays(to, -days);
  const count = (sql: string, ...p: unknown[]) => one<{ n: number }>(sql, ...p)!.n;

  const today = todayList(ctx);
  const dueTasks = count("SELECT COUNT(*) AS n FROM tasks WHERE studio_id = ? AND due_at >= ? AND due_at < ?", sid, from, to);
  const completedTasks = count("SELECT COUNT(*) AS n FROM tasks WHERE studio_id = ? AND due_at >= ? AND due_at < ? AND status = 'completed'", sid, from, to);
  const dismissedTasks = count("SELECT COUNT(*) AS n FROM tasks WHERE studio_id = ? AND due_at >= ? AND due_at < ? AND status = 'dismissed'", sid, from, to);
  const snoozedTasks = count("SELECT COUNT(*) AS n FROM tasks WHERE studio_id = ? AND due_at >= ? AND due_at < ? AND status = 'snoozed'", sid, from, to);

  const drafts = count("SELECT COUNT(*) AS n FROM message_drafts WHERE studio_id = ? AND created_at >= ?", sid, from);
  const waOpened = count("SELECT COUNT(DISTINCT draft_id) AS n FROM interaction_events WHERE studio_id = ? AND event_type = 'wa_opened' AND occurred_at >= ?", sid, from);
  const markedSent = count("SELECT COUNT(*) AS n FROM interaction_events WHERE studio_id = ? AND event_type = 'marked_sent' AND occurred_at >= ?", sid, from);
  const outcomes = count("SELECT COUNT(*) AS n FROM interaction_events WHERE studio_id = ? AND event_type = 'outcome_recorded' AND occurred_at >= ?", sid, from);
  const confirmed = count(
    "SELECT COUNT(*) AS n FROM interaction_events WHERE studio_id = ? AND occurred_at >= ? AND (event_type = 'marked_sent' OR (event_type = 'outcome_recorded' AND channel IN ('call','in_person') AND outcome <> 'no_answer'))",
    sid,
    from,
  );

  const outcomeBreakdown = all<{ outcome: string; n: number }>(
    "SELECT outcome, COUNT(*) AS n FROM interaction_events WHERE studio_id = ? AND event_type = 'outcome_recorded' AND occurred_at >= ? GROUP BY outcome ORDER BY n DESC",
    sid,
    from,
  );

  // Trial → membership within 30 days of the trial attendance (cohort = trials in the period).
  const trials = all<{ contact_id: string; checked_in_at: string }>(
    `SELECT a.contact_id, MIN(a.checked_in_at) AS checked_in_at FROM attendance a
       LEFT JOIN memberships m ON m.id = a.membership_id LEFT JOIN plans p ON p.id = m.plan_id
      WHERE a.studio_id = ? AND a.status <> 'reversed' AND a.checked_in_at >= ? AND (p.type = 'trial' OR a.membership_id IS NULL)
      GROUP BY a.contact_id`,
    sid,
    from,
  );
  const converted = trials.filter((t) =>
    one(
      "SELECT 1 FROM memberships m JOIN plans p ON p.id = m.plan_id WHERE m.contact_id = ? AND p.type <> 'trial' AND m.cancelled_at IS NULL AND m.created_at >= ? AND m.created_at <= ?",
      t.contact_id,
      t.checked_in_at,
      addDays(t.checked_in_at, 30),
    ),
  ).length;

  // Renewals documented within 14 days after a confirmed follow-up.
  const renewals = all<{ contact_id: string; occurred_at: string }>(
    "SELECT contact_id, occurred_at FROM interaction_events WHERE studio_id = ? AND event_type = 'renewal' AND occurred_at >= ?",
    sid,
    from,
  );
  const linkedRenewals = renewals.filter((r) =>
    one(
      "SELECT 1 FROM interaction_events WHERE contact_id = ? AND studio_id = ? AND event_type IN ('marked_sent','outcome_recorded') AND occurred_at <= ? AND occurred_at >= ?",
      r.contact_id,
      sid,
      r.occurred_at,
      addDays(r.occurred_at, -14),
    ),
  ).length;

  const totalContacts = count("SELECT COUNT(*) AS n FROM contacts WHERE studio_id = ? AND merged_into IS NULL AND archived = 0", sid);
  const validPhones = count("SELECT COUNT(*) AS n FROM contacts WHERE studio_id = ? AND merged_into IS NULL AND archived = 0 AND phone_valid = 1", sid);
  const needsReview = count("SELECT COUNT(*) AS n FROM contacts WHERE studio_id = ? AND merged_into IS NULL AND archived = 0 AND (needs_review = 1 OR phone_valid = 0)", sid);
  const aiDrafts = count("SELECT COUNT(*) AS n FROM usage_events WHERE studio_id = ? AND kind = 'ai_draft' AND created_at >= ?", sid, from);
  const aiFallbacks = count("SELECT COUNT(*) AS n FROM usage_events WHERE studio_id = ? AND kind = 'ai_fallback' AND created_at >= ?", sid, from);
  const aiUnits = count("SELECT COALESCE(SUM(units),0) AS n FROM usage_events WHERE studio_id = ? AND created_at >= ?", sid, from);

  const daily = all<{ day: string; sent: number; outcomes: number }>(
    `SELECT substr(occurred_at, 1, 10) AS day,
            SUM(CASE WHEN event_type = 'marked_sent' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN event_type = 'outcome_recorded' THEN 1 ELSE 0 END) AS outcomes
       FROM interaction_events WHERE studio_id = ? AND occurred_at >= ? GROUP BY day ORDER BY day`,
    sid,
    from,
  );
  const stageCounts = all<{ stage: string; n: number }>(
    "SELECT pipeline_stage AS stage, COUNT(*) AS n FROM contacts WHERE studio_id = ? AND merged_into IS NULL AND archived = 0 GROUP BY pipeline_stage",
    sid,
  );

  return {
    period: { from, to, days },
    followupsDue: today.counts.needFollowup,
    tasks: { due: dueTasks, completed: completedTasks, dismissed: dismissedTasks, snoozed: snoozedTasks, completionRate: dueTasks ? completedTasks / dueTasks : null },
    funnel: { drafts, waOpened, markedSent, outcomes, confirmed },
    outcomeBreakdown,
    trialConversion: { trials: trials.length, converted, rate: trials.length ? converted / trials.length : null },
    renewals: { total: renewals.length, linked: linkedRenewals },
    dataCoverage: { totalContacts, validPhones, needsReview, rate: totalContacts ? validPhones / totalContacts : null },
    ai: { drafts: aiDrafts, fallbacks: aiFallbacks, units: aiUnits, quota: ctx.studio.settings.aiMonthlyQuota },
    daily,
    stageCounts,
  };
}

export function auditLog(ctx: Ctx, f: { action?: string; page?: number }) {
  assertCan(ctx, "audit");
  const page = Math.max(1, f.page ?? 1);
  const where = ["a.studio_id = ?"];
  const params: unknown[] = [ctx.studio.id];
  if (f.action) {
    where.push("a.action LIKE ?");
    params.push(`${f.action}%`);
  } else {
    // Sign-ins are routine; they stay available under their own filter.
    where.push("a.action NOT LIKE 'auth.%'");
  }
  const items = all<{ id: string; action: string; entity: string; entity_id: string | null; reason: string | null; diff: string | null; created_at: string; actor: string | null }>(
    `SELECT a.id, a.action, a.entity, a.entity_id, a.reason, a.diff, a.created_at, u.name AS actor FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
      WHERE ${where.join(" AND ")} ORDER BY a.created_at DESC LIMIT 50 OFFSET ?`,
    ...params,
    (page - 1) * 50,
  );
  const total = one<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_events a WHERE ${where.join(" AND ")}`, ...params)!.n;
  return { items, total, page };
}

export function opsHealth(ctx: Ctx) {
  assertCan(ctx, "audit");
  const sid = ctx.studio.id;
  const since = addDays(nowIso(), -30);
  const aiByDay = all<{ day: string; drafts: number; fallbacks: number; avg_ms: number | null }>(
    `SELECT substr(created_at,1,10) AS day, SUM(kind='ai_draft') AS drafts, SUM(kind='ai_fallback') AS fallbacks, AVG(duration_ms) AS avg_ms
       FROM usage_events WHERE studio_id = ? AND created_at >= ? GROUP BY day ORDER BY day DESC LIMIT 30`,
    sid,
    since,
  );
  const lateTasks = one<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE studio_id = ? AND status IN ('open','in_progress') AND due_at < ?", sid, addDays(nowIso(), -2))!.n;
  const pendingReconciliation = one<{ n: number }>("SELECT COUNT(*) AS n FROM attendance WHERE studio_id = ? AND status = 'pending_reconciliation'", sid)!.n;
  const connections = all<{ provider: string; name: string; status: string; last_success_at: string | null; last_error: string | null }>(
    "SELECT provider, name, status, last_success_at, last_error FROM integration_connections WHERE studio_id = ?",
    sid,
  );
  return { aiByDay, lateTasks, pendingReconciliation, connections };
}
