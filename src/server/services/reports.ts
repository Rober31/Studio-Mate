// Reports & pilot measurement (spec §37). Counters keep WA-opened and
// marked-sent separate, and renewals are "linked in time", not attributed.

import { all, one } from "../db";
import { assertCan, type Ctx } from "../permissions";
import { addDays, nowIso } from "../util";
import { todayList } from "./followups";

const ISO = "%Y-%m-%dT%H:%M:%fZ";

export async function reportSummary(ctx: Ctx, days: number) {
  assertCan(ctx, "reports");
  const sid = ctx.studio.id;
  const to = nowIso();
  const from = addDays(to, -days);

  // All counters in one round trip.
  const countsSql = `SELECT
    (SELECT COUNT(*) FROM tasks WHERE studio_id = :sid AND due_at >= :from AND due_at < :to) AS due_tasks,
    (SELECT COUNT(*) FROM tasks WHERE studio_id = :sid AND due_at >= :from AND due_at < :to AND status = 'completed') AS completed_tasks,
    (SELECT COUNT(*) FROM tasks WHERE studio_id = :sid AND due_at >= :from AND due_at < :to AND status = 'dismissed') AS dismissed_tasks,
    (SELECT COUNT(*) FROM tasks WHERE studio_id = :sid AND due_at >= :from AND due_at < :to AND status = 'snoozed') AS snoozed_tasks,
    (SELECT COUNT(*) FROM message_drafts WHERE studio_id = :sid AND created_at >= :from) AS drafts,
    (SELECT COUNT(DISTINCT draft_id) FROM interaction_events WHERE studio_id = :sid AND event_type = 'wa_opened' AND occurred_at >= :from) AS wa_opened,
    (SELECT COUNT(*) FROM interaction_events WHERE studio_id = :sid AND event_type = 'marked_sent' AND occurred_at >= :from) AS marked_sent,
    (SELECT COUNT(*) FROM interaction_events WHERE studio_id = :sid AND event_type = 'outcome_recorded' AND occurred_at >= :from) AS outcomes,
    (SELECT COUNT(*) FROM interaction_events WHERE studio_id = :sid AND occurred_at >= :from
        AND (event_type = 'marked_sent' OR (event_type = 'outcome_recorded' AND channel IN ('call','in_person') AND outcome <> 'no_answer'))) AS confirmed,
    (SELECT COUNT(*) FROM contacts WHERE studio_id = :sid AND merged_into IS NULL AND archived = 0) AS total_contacts,
    (SELECT COUNT(*) FROM contacts WHERE studio_id = :sid AND merged_into IS NULL AND archived = 0 AND phone_valid = 1) AS valid_phones,
    (SELECT COUNT(*) FROM contacts WHERE studio_id = :sid AND merged_into IS NULL AND archived = 0 AND (needs_review = 1 OR phone_valid = 0)) AS needs_review,
    (SELECT COUNT(*) FROM usage_events WHERE studio_id = :sid AND kind = 'ai_draft' AND created_at >= :from) AS ai_drafts,
    (SELECT COUNT(*) FROM usage_events WHERE studio_id = :sid AND kind = 'ai_fallback' AND created_at >= :from) AS ai_fallbacks,
    (SELECT COALESCE(SUM(units),0) FROM usage_events WHERE studio_id = :sid AND created_at >= :from) AS ai_units`;

  // Trial → membership within 30 days of the trial attendance (cohort = trials in the period).
  const trialSql = `WITH trials AS (
      SELECT a.contact_id, MIN(a.checked_in_at) AS at FROM attendance a
        LEFT JOIN memberships m ON m.id = a.membership_id LEFT JOIN plans p ON p.id = m.plan_id
       WHERE a.studio_id = ? AND a.status <> 'reversed' AND a.checked_in_at >= ? AND (p.type = 'trial' OR a.membership_id IS NULL)
       GROUP BY a.contact_id)
    SELECT COUNT(*) AS trials,
           COALESCE(SUM(EXISTS (SELECT 1 FROM memberships m JOIN plans p ON p.id = m.plan_id
              WHERE m.contact_id = t.contact_id AND p.type <> 'trial' AND m.cancelled_at IS NULL
                AND m.created_at >= t.at AND m.created_at <= strftime('${ISO}', t.at, '+30 days'))), 0) AS converted
      FROM trials t`;

  // Renewals documented within 14 days after a confirmed follow-up.
  const renewalSql = `SELECT COUNT(*) AS total,
      COALESCE(SUM(EXISTS (SELECT 1 FROM interaction_events f WHERE f.contact_id = r.contact_id AND f.studio_id = r.studio_id
        AND f.event_type IN ('marked_sent','outcome_recorded') AND f.occurred_at <= r.occurred_at
        AND f.occurred_at >= strftime('${ISO}', r.occurred_at, '-14 days'))), 0) AS linked
    FROM interaction_events r WHERE r.studio_id = ? AND r.event_type = 'renewal' AND r.occurred_at >= ?`;

  const [today, c, trial, renewal, outcomeBreakdown, daily, stageCounts] = await Promise.all([
    todayList(ctx),
    one<Record<string, number>>(countsSql.replace(/:sid/g, "?1").replace(/:from/g, "?2").replace(/:to/g, "?3"), sid, from, to),
    one<{ trials: number; converted: number }>(trialSql, sid, from),
    one<{ total: number; linked: number }>(renewalSql, sid, from),
    all<{ outcome: string; n: number }>(
      "SELECT outcome, COUNT(*) AS n FROM interaction_events WHERE studio_id = ? AND event_type = 'outcome_recorded' AND occurred_at >= ? GROUP BY outcome ORDER BY n DESC",
      sid,
      from,
    ),
    all<{ day: string; sent: number; outcomes: number }>(
      `SELECT substr(occurred_at, 1, 10) AS day,
              SUM(CASE WHEN event_type = 'marked_sent' THEN 1 ELSE 0 END) AS sent,
              SUM(CASE WHEN event_type = 'outcome_recorded' THEN 1 ELSE 0 END) AS outcomes
         FROM interaction_events WHERE studio_id = ? AND occurred_at >= ? GROUP BY day ORDER BY day`,
      sid,
      from,
    ),
    all<{ stage: string; n: number }>(
      "SELECT pipeline_stage AS stage, COUNT(*) AS n FROM contacts WHERE studio_id = ? AND merged_into IS NULL AND archived = 0 GROUP BY pipeline_stage",
      sid,
    ),
  ]);
  const n = (k: string) => Number(c?.[k] ?? 0);
  const dueTasks = n("due_tasks");
  const completedTasks = n("completed_tasks");
  const totalContacts = n("total_contacts");
  const validPhones = n("valid_phones");
  const trials = trial?.trials ?? 0;
  const converted = trial?.converted ?? 0;

  return {
    period: { from, to, days },
    followupsDue: today.counts.needFollowup,
    tasks: { due: dueTasks, completed: completedTasks, dismissed: n("dismissed_tasks"), snoozed: n("snoozed_tasks"), completionRate: dueTasks ? completedTasks / dueTasks : null },
    funnel: { drafts: n("drafts"), waOpened: n("wa_opened"), markedSent: n("marked_sent"), outcomes: n("outcomes"), confirmed: n("confirmed") },
    outcomeBreakdown,
    trialConversion: { trials, converted, rate: trials ? converted / trials : null },
    renewals: { total: renewal?.total ?? 0, linked: renewal?.linked ?? 0 },
    dataCoverage: { totalContacts, validPhones, needsReview: n("needs_review"), rate: totalContacts ? validPhones / totalContacts : null },
    ai: { drafts: n("ai_drafts"), fallbacks: n("ai_fallbacks"), units: n("ai_units"), quota: ctx.studio.settings.aiMonthlyQuota },
    daily,
    stageCounts,
  };
}

export async function auditLog(ctx: Ctx, f: { action?: string; page?: number }) {
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
  const items = await all<{ id: string; action: string; entity: string; entity_id: string | null; reason: string | null; diff: string | null; created_at: string; actor: string | null }>(
    `SELECT a.id, a.action, a.entity, a.entity_id, a.reason, a.diff, a.created_at, u.name AS actor FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
      WHERE ${where.join(" AND ")} ORDER BY a.created_at DESC LIMIT 50 OFFSET ?`,
    ...params,
    (page - 1) * 50,
  );
  const total = (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_events a WHERE ${where.join(" AND ")}`, ...params))!.n;
  return { items, total, page };
}

export async function opsHealth(ctx: Ctx) {
  assertCan(ctx, "audit");
  const sid = ctx.studio.id;
  const since = addDays(nowIso(), -30);
  const [aiByDay, late, pending, connections] = await Promise.all([
    all<{ day: string; drafts: number; fallbacks: number; avg_ms: number | null }>(
      `SELECT substr(created_at,1,10) AS day, SUM(kind='ai_draft') AS drafts, SUM(kind='ai_fallback') AS fallbacks, AVG(duration_ms) AS avg_ms
         FROM usage_events WHERE studio_id = ? AND created_at >= ? GROUP BY day ORDER BY day DESC LIMIT 30`,
      sid,
      since,
    ),
    one<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE studio_id = ? AND status IN ('open','in_progress') AND due_at < ?", sid, addDays(nowIso(), -2)),
    one<{ n: number }>("SELECT COUNT(*) AS n FROM attendance WHERE studio_id = ? AND status = 'pending_reconciliation'", sid),
    all<{ provider: string; name: string; status: string; last_success_at: string | null; last_error: string | null }>(
      "SELECT provider, name, status, last_success_at, last_error FROM integration_connections WHERE studio_id = ?",
      sid,
    ),
  ]);
  const lateTasks = late?.n ?? 0;
  const pendingReconciliation = pending?.n ?? 0;
  return { aiByDay, lateTasks, pendingReconciliation, connections };
}
