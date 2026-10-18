// Follow-up rules engine (spec §12–§13, FUP-01/02).
// Rules decide eligibility deterministically; AI only helps with wording.

import { all, batch, one, placeholders, run } from "../db";
import { assertCan, contactScopeSql, type Ctx } from "../permissions";
import type { RuleKey, Studio } from "../studio";
import { addDays, hashObject, id, nowIso, parseJson } from "../util";
import { localDate, localDayDiff, startOfLocalDay, addLocalDays } from "../time";
import { membershipViews, type MembershipView } from "./memberships";
import { AppError, invalid, notFound } from "../errors";

export const RULE_PRIORITY: Record<RuleKey | "TASK", number> = {
  TASK: 1,
  R06: 1,
  R03: 2,
  R02: 3,
  R01: 4,
  R04: 5,
  R05: 6,
  R07: 7,
};

export type Facts = {
  rule: RuleKey | "GENERAL";
  first_name: string;
  language: string;
  plan_name?: string;
  end_date?: string;
  days_left?: number;
  balance?: number;
  last_attendance?: string;
  days_since_attendance?: number;
  trial_date?: string;
  ended_date?: string;
  interest?: string;
};

export type Candidate = {
  rule: RuleKey;
  eventKey: string;
  priority: number;
  dueAt: string;
  facts: Facts;
};

export type ContactLite = {
  id: string;
  display_name: string;
  preferred_language: string | null;
  pipeline_stage: string;
  interest: string | null;
  created_at: string;
};

export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName;
}

function isStale(m: MembershipView, studio: Studio, at: number): boolean {
  if (m.authority !== "external") return false;
  if (!m.source_updated_at) return true;
  return at - Date.parse(m.source_updated_at) > studio.settings.importFreshnessHours * 3_600_000;
}

export type RuleContext = {
  memberships: Map<string, MembershipView[]>;
  /** Latest 'present' attendance per contact. */
  lastAttendance: Map<string, string>;
  /** Latest trial (or membership-less) attendance per contact. */
  latestTrial: Map<string, { id: string; checked_in_at: string }>;
  /** Contacts with a confirmed contact event (not 'no answer'). */
  confirmed: Set<string>;
};

const CHUNK = 500;
async function inChunks<T>(ids: string[] | undefined, fn: (filter: string, params: string[]) => Promise<T[]>): Promise<T[]> {
  if (!ids) return fn("", []);
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    out.push(...(await fn(` AND contact_id IN (${placeholders(part.length)})`, part)));
  }
  return out;
}

/**
 * Loads everything the rules need for many contacts in a constant number of
 * queries (the production database is remote; never query per contact).
 */
export async function loadRuleContext(studio: Studio, contactIds?: string[]): Promise<RuleContext> {
  const sid = studio.id;
  const ids = contactIds ? Array.from(new Set(contactIds)) : undefined;
  const [views, last, trials, confirmed] = await Promise.all([
    membershipViews(sid, ids ? { contactIds: ids } : {}),
    inChunks(ids, (f, p) =>
      all<{ contact_id: string; t: string }>(
        `SELECT contact_id, MAX(checked_in_at) AS t FROM attendance WHERE studio_id = ? AND status = 'present'${f} GROUP BY contact_id`,
        sid,
        ...p,
      ),
    ),
    inChunks(ids, (f, p) =>
      all<{ contact_id: string; id: string; checked_in_at: string }>(
        `SELECT a.contact_id, a.id, a.checked_in_at FROM attendance a
           LEFT JOIN memberships m ON m.id = a.membership_id
           LEFT JOIN plans p ON p.id = m.plan_id
          WHERE a.studio_id = ? AND a.status = 'present' AND (p.type = 'trial' OR a.membership_id IS NULL)${f.replace("contact_id", "a.contact_id")}
          ORDER BY a.checked_in_at DESC`,
        sid,
        ...p,
      ),
    ),
    inChunks(ids, (f, p) =>
      all<{ contact_id: string }>(
        `SELECT DISTINCT contact_id FROM interaction_events
          WHERE studio_id = ? AND event_type IN ('marked_sent','outcome_recorded','call') AND COALESCE(outcome,'') <> 'no_answer'${f}`,
        sid,
        ...p,
      ),
    ),
  ]);
  const memberships = new Map<string, MembershipView[]>();
  for (const v of views) memberships.set(v.contact_id, [...(memberships.get(v.contact_id) ?? []), v]);
  const latestTrial = new Map<string, { id: string; checked_in_at: string }>();
  for (const t of trials) if (!latestTrial.has(t.contact_id)) latestTrial.set(t.contact_id, { id: t.id, checked_in_at: t.checked_in_at });
  return {
    memberships,
    lastAttendance: new Map(last.map((r) => [r.contact_id, r.t])),
    latestTrial,
    confirmed: new Set(confirmed.map((r) => r.contact_id)),
  };
}

/** Computes every rule candidate for one contact from current facts. */
export function candidatesFor(studio: Studio, c: ContactLite, rc: RuleContext, nowAt = nowIso()): Candidate[] {
  const tz = studio.timezone;
  const rules = studio.settings.rules;
  const now = Date.parse(nowAt);
  const lang = c.preferred_language || studio.settings.messageLanguage;
  const base = { first_name: firstName(c.display_name), language: lang, ...(c.interest ? { interest: c.interest } : {}) };
  const out: Candidate[] = [];
  if (c.pipeline_stage === "lost") return out; // final refusal: no marketing rules

  const memberships = rc.memberships.get(c.id) ?? [];
  const lastAt = rc.lastAttendance.get(c.id);
  const lastAttendance = lastAt ? { checked_in_at: lastAt } : undefined;
  const nonTrialActive = memberships.filter((m) => m.plan_type !== "trial" && (m.status === "active" || m.status === "pending" || m.status === "paused"));

  // R01 · New lead without confirmed contact.
  if (rules.R01.enabled && c.pipeline_stage === "new_lead") {
    const confirmed = rc.confirmed.has(c.id);
    if (!confirmed) {
      out.push({
        rule: "R01",
        eventKey: `R01:${c.id}`,
        priority: RULE_PRIORITY.R01,
        dueAt: addDays(c.created_at, rules.R01.days ?? 1),
        facts: { rule: "R01", ...base },
      });
    }
  }

  // R02 · Attended a trial ≥ N days ago, no active membership and no refusal.
  if (rules.R02.enabled && !nonTrialActive.length) {
    const trial = rc.latestTrial.get(c.id);
    const isTrialStage = ["trial_attended", "trial_scheduled", "decision_pending", "contacted", "new_lead"].includes(c.pipeline_stage);
    if (trial && isTrialStage && localDayDiff(trial.checked_in_at, nowAt, tz) >= (rules.R02.days ?? 1)) {
      out.push({
        rule: "R02",
        eventKey: `R02:${c.id}:${trial.id}`,
        priority: RULE_PRIORITY.R02,
        dueAt: addDays(trial.checked_in_at, rules.R02.days ?? 1),
        facts: { rule: "R02", ...base, trial_date: localDate(trial.checked_in_at, tz) },
      });
    }
  }

  for (const m of memberships) {
    if (m.plan_type === "trial") continue;
    const stale = isStale(m, studio, now);
    if (stale) continue; // stale source: rules that depend on it are paused

    // R03 · Active membership ending within N days with no future renewal.
    if (rules.R03.enabled && m.status === "active" && m.ends_at) {
      const endDate = localDate(new Date(Date.parse(m.ends_at) - 1), tz);
      const daysLeft = localDayDiff(nowAt, new Date(Date.parse(m.ends_at) - 1), tz);
      const renewed = memberships.some(
        (o) => o.id !== m.id && o.status !== "cancelled" && (o.renewed_from === m.id || o.starts_at >= m.starts_at) && (o.ends_at ?? "9999") > m.ends_at!,
      );
      if (daysLeft >= 0 && daysLeft <= (rules.R03.days ?? 5) && !renewed) {
        out.push({
          rule: "R03",
          eventKey: `R03:${m.id}:${m.ends_at}`,
          priority: RULE_PRIORITY.R03,
          dueAt: startOfLocalDay(addLocalDays(endDate, -(rules.R03.days ?? 5)), tz).toISOString(),
          facts: { rule: "R03", ...base, plan_name: m.plan_name, end_date: endDate, days_left: daysLeft },
        });
      }
    }

    // R04 · Valid punch card with ≤ threshold sessions left.
    if (rules.R04.enabled && m.status === "active" && m.balance !== null && m.balance > 0 && m.balance <= (rules.R04.threshold ?? 2)) {
      const renewed = memberships.some((o) => o.id !== m.id && o.starts_at >= m.starts_at && o.status !== "cancelled" && o.status !== "expired");
      if (!renewed) {
        out.push({
          rule: "R04",
          eventKey: `R04:${m.id}`,
          priority: RULE_PRIORITY.R04,
          dueAt: nowAt,
          facts: { rule: "R04", ...base, plan_name: m.plan_name, balance: m.balance },
        });
      }
    }

    // R05 · Eligible member who has not attended for N days, no known pause.
    if (rules.R05.enabled && m.status === "active" && !m.paused_now) {
      const since = lastAttendance?.checked_in_at && lastAttendance.checked_in_at > m.starts_at ? lastAttendance.checked_in_at : m.starts_at;
      const days = localDayDiff(since, nowAt, tz);
      if (days >= (rules.R05.days ?? 14)) {
        out.push({
          rule: "R05",
          eventKey: `R05:${c.id}:${localDate(since, tz)}`,
          priority: RULE_PRIORITY.R05,
          dueAt: addDays(since, rules.R05.days ?? 14),
          facts: {
            rule: "R05",
            ...base,
            plan_name: m.plan_name,
            days_since_attendance: days,
            ...(lastAttendance ? { last_attendance: localDate(lastAttendance.checked_in_at, tz) } : {}),
          },
        });
      }
    }
  }

  // R07 · Membership ended within N days, nothing newer (off by default).
  if (rules.R07.enabled && !nonTrialActive.length) {
    const ended = memberships
      .filter((m) => m.plan_type !== "trial" && m.status === "expired" && m.ends_at && !isStale(m, studio, now))
      .sort((a, b) => (a.ends_at! < b.ends_at! ? 1 : -1))[0];
    if (ended) {
      const days = localDayDiff(new Date(Date.parse(ended.ends_at!) - 1), nowAt, tz);
      if (days >= 1 && days <= (rules.R07.days ?? 14)) {
        out.push({
          rule: "R07",
          eventKey: `R07:${ended.id}`,
          priority: RULE_PRIORITY.R07,
          dueAt: ended.ends_at!,
          facts: { rule: "R07", ...base, plan_name: ended.plan_name, ended_date: localDate(new Date(Date.parse(ended.ends_at!) - 1), tz) },
        });
      }
    }
  }
  return out;
}

// Rules whose suggestions are superseded once their condition no longer holds.
const CONDITIONAL: RuleKey[] = ["R01", "R02", "R03", "R04", "R05", "R07"];
const BATCH = 200;

async function runBatches(stmts: [string, ...unknown[]][]): Promise<number> {
  let changes = 0;
  for (let i = 0; i < stmts.length; i += BATCH) {
    for (const r of await batch(stmts.slice(i, i + BATCH))) changes += r.changes;
  }
  return changes;
}

const FRESH_KEY = "rules_evaluated_at";

/**
 * Evaluates all rules for a studio. Idempotent: the unique event key prevents
 * duplicate suggestions (AC-03). Reads in bulk, writes in batches.
 */
export async function evaluateStudio(studio: Studio, nowAt = nowIso()) {
  const contacts = await all<ContactLite>(
    "SELECT id, display_name, preferred_language, pipeline_stage, interest, created_at FROM contacts WHERE studio_id = ? AND merged_into IS NULL AND archived = 0",
    studio.id,
  );
  const [rc, open] = await Promise.all([
    loadRuleContext(studio),
    all<{ id: string; event_key: string; rule_id: RuleKey; facts_hash: string }>(
      "SELECT id, event_key, rule_id, facts_hash FROM suggestions WHERE studio_id = ? AND status IN ('active','snoozed')",
      studio.id,
    ),
  ]);
  const openByKey = new Map(open.map((s) => [s.event_key, s]));
  const seen = new Set<string>();
  const inserts: [string, ...unknown[]][] = [];
  const writes: [string, ...unknown[]][] = [];
  for (const c of contacts) {
    for (const cand of candidatesFor(studio, c, rc, nowAt)) {
      seen.add(cand.eventKey);
      const factsJson = JSON.stringify({ ...cand.facts, due_at: cand.dueAt });
      const hash = hashObject(cand.facts);
      const existing = openByKey.get(cand.eventKey);
      if (existing) {
        // Refresh facts (e.g. days left) on still-open suggestions.
        if (existing.facts_hash !== hash) {
          writes.push(["UPDATE suggestions SET facts = ?, facts_hash = ?, updated_at = ? WHERE id = ?", factsJson, hash, nowAt, existing.id]);
        }
      } else {
        // Closed suggestions keep their key, so OR IGNORE never re-opens them.
        inserts.push([
          `INSERT OR IGNORE INTO suggestions (id, studio_id, contact_id, rule_id, event_key, priority, facts, facts_hash, status, valid_until, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?, 'active', NULL, ?, ?)`,
          id("sug"),
          studio.id,
          c.id,
          cand.rule,
          cand.eventKey,
          cand.priority,
          factsJson,
          hash,
          nowAt,
          nowAt,
        ]);
      }
    }
  }
  for (const s of open) {
    if (CONDITIONAL.includes(s.rule_id) && !seen.has(s.event_key)) {
      writes.push(["UPDATE suggestions SET status = 'superseded', status_reason = 'condition_cleared', updated_at = ? WHERE id = ?", nowAt, s.id]);
      writes.push([
        "UPDATE message_drafts SET status = 'invalidated', invalid_reason = 'reason_cleared', updated_at = ? WHERE suggestion_id = ? AND status IN ('ready','edited')",
        nowAt,
        s.id,
      ]);
    }
  }
  writes.push(["UPDATE suggestions SET status = 'active', snoozed_until = NULL, updated_at = ? WHERE studio_id = ? AND status = 'snoozed' AND snoozed_until <= ?", nowAt, studio.id, nowAt]);
  writes.push([
    "UPDATE tasks SET status = 'open', snoozed_until = NULL, version = version + 1, updated_at = ? WHERE studio_id = ? AND status = 'snoozed' AND snoozed_until <= ?",
    nowAt,
    studio.id,
    nowAt,
  ]);
  writes.push([
    "INSERT INTO job_state (studio_id, key, value, updated_at) VALUES (?,?,?,?) ON CONFLICT(studio_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    studio.id,
    FRESH_KEY,
    nowAt,
    nowAt,
  ]);
  const created = await runBatches(inserts);
  await runBatches(writes);
  return { created };
}

export async function lastEvaluatedAt(studioId: string): Promise<string | null> {
  return (await one<{ value: string }>("SELECT value FROM job_state WHERE studio_id = ? AND key = ?", studioId, FRESH_KEY))?.value ?? null;
}

/**
 * Re-evaluates when the last run (persisted in the DB, shared by all server
 * instances) is older than maxAgeMs. Returns the evaluation time.
 */
export async function ensureFresh(studio: Studio, maxAgeMs = 5 * 60_000): Promise<string> {
  const last = await lastEvaluatedAt(studio.id);
  if (last && Date.now() - Date.parse(last) <= maxAgeMs) return last;
  const at = nowIso();
  await evaluateStudio(studio, at);
  return at;
}

/** Forces the next ensureFresh() to re-evaluate (after data that affects rules changed). */
export async function markEvaluationStale(studioId: string): Promise<void> {
  await run("DELETE FROM job_state WHERE studio_id = ? AND key = ?", studioId, FRESH_KEY);
}

// ---------------------------------------------------------------------------
// Guards (spec §13 Priority & Suppression). Re-checked before draft and handoff.

export type Guards = {
  blocked: boolean;
  blockReason: string | null;
  phoneInvalid: boolean;
  needsReview: boolean;
  cooldownUntil: string | null;
  recentContacts: number;
  overLimit: boolean;
  lost: boolean;
};

type GuardContact = {
  id: string;
  display_name: string;
  phone_e164: string | null;
  phone_valid: number;
  needs_review: number;
  pipeline_stage: string;
  owner_id: string | null;
  owner_name: string | null;
  source: string;
  version: number;
  allowed: number | null;
  reason: string | null;
};

/** Guards and basic card data for many contacts in 3 queries. */
async function loadGuards(studio: Studio, contactIds: string[], nowAt: string) {
  const out = new Map<string, { contact: GuardContact; guards: Guards }>();
  const ids = Array.from(new Set(contactIds));
  const weekAgo = addDays(nowAt, -7);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const ph = placeholders(part.length);
    const [contacts, marketing] = await Promise.all([
      all<GuardContact>(
        `SELECT c.id, c.display_name, c.phone_e164, c.phone_valid, c.needs_review, c.pipeline_stage, c.owner_id, u.name AS owner_name, c.source, c.version,
                p.allowed, p.reason
           FROM contacts c
           LEFT JOIN users u ON u.id = c.owner_id
           LEFT JOIN contact_preferences p ON p.contact_id = c.id AND p.channel = 'whatsapp'
          WHERE c.studio_id = ? AND c.id IN (${ph})`,
        studio.id,
        ...part,
      ),
      all<{ contact_id: string; last_at: string; recent: number }>(
        `SELECT contact_id, MAX(occurred_at) AS last_at, SUM(CASE WHEN occurred_at > ? THEN 1 ELSE 0 END) AS recent
           FROM interaction_events WHERE studio_id = ? AND marketing = 1 AND contact_id IN (${ph}) GROUP BY contact_id`,
        weekAgo,
        studio.id,
        ...part,
      ),
    ]);
    const mk = new Map(marketing.map((m) => [m.contact_id, m]));
    for (const c of contacts) {
      const m = mk.get(c.id);
      const cooldownEnd = m ? new Date(Date.parse(m.last_at) + studio.settings.cooldownHours * 3_600_000).toISOString() : null;
      const recent = m?.recent ?? 0;
      out.set(c.id, {
        contact: c,
        guards: {
          blocked: c.allowed === 0,
          blockReason: c.allowed === 0 ? c.reason : null,
          phoneInvalid: !c.phone_e164 || c.phone_valid !== 1,
          needsReview: c.needs_review === 1,
          cooldownUntil: cooldownEnd && cooldownEnd > nowAt ? cooldownEnd : null,
          recentContacts: recent,
          overLimit: recent >= studio.settings.maxContactsPer7Days,
          lost: c.pipeline_stage === "lost",
        },
      });
    }
  }
  return out;
}

export async function contactGuards(studio: Studio, contactId: string, nowAt = nowIso()): Promise<Guards> {
  const g = (await loadGuards(studio, [contactId], nowAt)).get(contactId);
  if (!g) throw notFound("הלקוח");
  return g.guards;
}

// ---------------------------------------------------------------------------
// Today list (S02)

export type TodayReason = {
  kind: "rule" | "task";
  rule: RuleKey | "TASK";
  suggestionId?: string;
  taskId?: string;
  title?: string | null;
  facts?: Facts;
  priority: number;
  dueAt: string;
  status?: string;
  assignee?: string | null;
};

export type TodayCard = {
  contactId: string;
  name: string;
  phone: string | null;
  stage: string;
  ownerId: string | null;
  ownerName: string | null;
  source: string;
  reasons: TodayReason[];
  priority: number;
  dueAt: string;
  overdue: boolean;
  lastContact: { at: string; type: string; outcome: string | null } | null;
  guards: Guards;
  version: number;
};

export type Excluded = { contactId: string; name: string; rule: RuleKey | "TASK"; reason: string };

export type TodayFilters = { owner?: string; rule?: string; priority?: "high" | "medium" | "low"; due?: "overdue" | "today"; source?: string };

export function priorityLevel(p: number): "high" | "medium" | "low" {
  return p <= 4 ? "high" : p <= 6 ? "medium" : "low";
}

export async function todayList(ctx: Ctx, filters: TodayFilters = {}) {
  assertCan(ctx, "contacts.view");
  const studio = ctx.studio;
  const evaluatedAt = await ensureFresh(studio);
  const nowAt = nowIso();
  const tz = studio.timezone;
  const todayStart = startOfLocalDay(localDate(nowAt, tz), tz).toISOString();
  const tomorrowStart = startOfLocalDay(addLocalDays(localDate(nowAt, tz), 1), tz).toISOString();
  const scope = contactScopeSql(ctx);

  const [sugs, tasks, freshness] = await Promise.all([
    all<{ id: string; contact_id: string; rule_id: RuleKey; priority: number; facts: string; status: string }>(
      `SELECT s.id, s.contact_id, s.rule_id, s.priority, s.facts, s.status
         FROM suggestions s JOIN contacts c ON c.id = s.contact_id
        WHERE s.studio_id = ? AND s.status = 'active' AND c.merged_into IS NULL AND c.archived = 0 AND ${scope.sql}`,
      studio.id,
      ...scope.params,
    ),
    all<{ id: string; contact_id: string; reason_code: string; title: string | null; due_at: string; status: string; assignee_name: string | null; assignee_id: string | null }>(
      `SELECT t.id, t.contact_id, t.reason_code, t.title, t.due_at, t.status, u.name AS assignee_name, t.assignee_id
         FROM tasks t JOIN contacts c ON c.id = t.contact_id LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.studio_id = ? AND t.status IN ('open','in_progress') AND t.due_at < ? AND c.merged_into IS NULL AND ${scope.sql}`,
      studio.id,
      tomorrowStart,
      ...scope.params,
    ),
    dataFreshness(studio),
  ]);

  const byContact = new Map<string, TodayReason[]>();
  const push = (cid: string, r: TodayReason) => {
    const arr = byContact.get(cid) ?? [];
    arr.push(r);
    byContact.set(cid, arr);
  };
  for (const s of sugs) {
    const facts = parseJson<Facts & { due_at?: string }>(s.facts, { rule: s.rule_id, first_name: "", language: "he" });
    push(s.contact_id, { kind: "rule", rule: s.rule_id, suggestionId: s.id, facts, priority: s.priority, dueAt: facts.due_at ?? nowAt });
  }
  for (const t of tasks) {
    push(t.contact_id, {
      kind: "task",
      rule: "TASK",
      taskId: t.id,
      title: t.title,
      priority: RULE_PRIORITY.TASK,
      dueAt: t.due_at,
      status: t.status,
      assignee: t.assignee_name,
    });
  }

  const ids = Array.from(byContact.keys());
  const guardMap = await loadGuards(studio, ids, nowAt);
  const lastContacts = new Map<string, { occurred_at: string; event_type: string; outcome: string | null }>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const rows = await all<{ contact_id: string; occurred_at: string; event_type: string; outcome: string | null }>(
      `SELECT contact_id, occurred_at, event_type, outcome FROM (
         SELECT contact_id, occurred_at, event_type, outcome,
                ROW_NUMBER() OVER (PARTITION BY contact_id ORDER BY occurred_at DESC) AS rn
           FROM interaction_events
          WHERE studio_id = ? AND event_type IN ('marked_sent','outcome_recorded','call','wa_opened') AND contact_id IN (${placeholders(part.length)})
       ) WHERE rn = 1`,
      studio.id,
      ...part,
    );
    for (const r of rows) lastContacts.set(r.contact_id, r);
  }

  const cards: TodayCard[] = [];
  const excluded: Excluded[] = [];
  for (const [cid, reasons] of byContact) {
    const entry = guardMap.get(cid);
    if (!entry) continue;
    const { contact: c, guards } = entry;
    const kept: TodayReason[] = [];
    for (const r of reasons) {
      if (r.kind === "task") {
        kept.push(r);
        continue;
      }
      if (guards.blocked) excluded.push({ contactId: cid, name: c.display_name, rule: r.rule, reason: "blocked" });
      else if (guards.cooldownUntil) excluded.push({ contactId: cid, name: c.display_name, rule: r.rule, reason: "cooldown" });
      else if (guards.overLimit) excluded.push({ contactId: cid, name: c.display_name, rule: r.rule, reason: "limit" });
      else kept.push(r);
    }
    if (!kept.length) continue;
    kept.sort((a, b) => a.priority - b.priority || (a.dueAt < b.dueAt ? -1 : 1));
    const due = kept.reduce((m, r) => (r.dueAt < m ? r.dueAt : m), kept[0].dueAt);
    const last = lastContacts.get(cid);
    cards.push({
      contactId: cid,
      name: c.display_name,
      phone: c.phone_e164,
      stage: c.pipeline_stage,
      ownerId: c.owner_id,
      ownerName: c.owner_name,
      source: c.source,
      reasons: kept,
      priority: kept[0].priority,
      dueAt: due,
      overdue: due < todayStart,
      lastContact: last ? { at: last.occurred_at, type: last.event_type, outcome: last.outcome } : null,
      guards,
      version: c.version,
    });
  }

  const counts = {
    needFollowup: cards.length,
    overdue: cards.filter((c) => c.overdue).length,
    endingSoon: cards.filter((c) => c.reasons.some((r) => r.rule === "R03" || r.rule === "R04")).length,
  };

  let filtered = cards;
  if (filters.owner === "me") filtered = filtered.filter((c) => c.ownerId === ctx.userId || c.reasons.some((r) => r.kind === "task" && r.assignee === ctx.name));
  else if (filters.owner === "none") filtered = filtered.filter((c) => !c.ownerId);
  else if (filters.owner) filtered = filtered.filter((c) => c.ownerId === filters.owner);
  if (filters.rule) filtered = filtered.filter((c) => c.reasons.some((r) => r.rule === filters.rule));
  if (filters.priority) filtered = filtered.filter((c) => priorityLevel(c.priority) === filters.priority);
  if (filters.due === "overdue") filtered = filtered.filter((c) => c.overdue);
  if (filters.due === "today") filtered = filtered.filter((c) => !c.overdue);
  if (filters.source) filtered = filtered.filter((c) => c.source === filters.source);
  filtered.sort((a, b) => a.priority - b.priority || (a.dueAt < b.dueAt ? -1 : 1));

  return { cards: filtered, counts, excluded, freshness, evaluatedAt };
}

/** Freshness of external sources (INT-01). Returns warnings for stale data. */
export async function dataFreshness(studio: Studio) {
  const [conns, ext] = await Promise.all([
    all<{ provider: string; name: string; last_success_at: string | null; freshness_hours: number; status: string }>(
      "SELECT provider, name, last_success_at, freshness_hours, status FROM integration_connections WHERE studio_id = ?",
      studio.id,
    ),
    one<{ n: number; t: string | null }>("SELECT COUNT(*) AS n, MAX(source_updated_at) AS t FROM memberships WHERE studio_id = ? AND authority = 'external'", studio.id),
  ]);
  const externalCount = ext?.n ?? 0;
  const lastImport = ext?.t ?? null;
  const stale = externalCount > 0 && (!lastImport || Date.now() - Date.parse(lastImport) > studio.settings.importFreshnessHours * 3_600_000);
  return { connections: conns, externalMemberships: externalCount, lastImportAt: lastImport, stale };
}

// ---------------------------------------------------------------------------
// Suggestion actions

export async function getSuggestion(ctx: Ctx, suggestionId: string) {
  const scope = contactScopeSql(ctx);
  const s = await one<{ id: string; contact_id: string; rule_id: RuleKey; status: string; facts: string; facts_hash: string; event_key: string }>(
    `SELECT s.id, s.contact_id, s.rule_id, s.status, s.facts, s.facts_hash, s.event_key FROM suggestions s JOIN contacts c ON c.id = s.contact_id
      WHERE s.id = ? AND s.studio_id = ? AND ${scope.sql}`,
    suggestionId,
    ctx.studio.id,
    ...scope.params,
  );
  if (!s) throw notFound("ההצעה");
  return s;
}

export async function snoozeSuggestion(ctx: Ctx, suggestionId: string, until: string, reason?: string) {
  assertCan(ctx, "followup.use");
  const s = await getSuggestion(ctx, suggestionId);
  if (s.status !== "active") throw new AppError("conflict", "ההצעה כבר טופלה.");
  if (!until || Number.isNaN(Date.parse(until)) || until <= nowIso()) throw invalid({ until: "בחרו מועד עתידי." });
  await run(
    "UPDATE suggestions SET status = 'snoozed', snoozed_until = ?, status_reason = ?, updated_at = ? WHERE id = ?",
    new Date(until).toISOString(),
    reason?.trim() || null,
    nowIso(),
    suggestionId,
  );
}

export async function dismissSuggestion(ctx: Ctx, suggestionId: string, reason: string) {
  assertCan(ctx, "followup.use");
  const s = await getSuggestion(ctx, suggestionId);
  if (s.status !== "active" && s.status !== "snoozed") throw new AppError("conflict", "ההצעה כבר טופלה.");
  if (!reason?.trim()) throw invalid({ reason: "כתבו למה מחריגים את הסיבה." });
  await batch([
    ["UPDATE suggestions SET status = 'dismissed', status_reason = ?, updated_at = ? WHERE id = ?", reason.trim(), nowIso(), suggestionId],
    ["UPDATE message_drafts SET status = 'invalidated', invalid_reason = 'dismissed', updated_at = ? WHERE suggestion_id = ? AND status IN ('ready','edited')", nowIso(), suggestionId],
  ]);
}

export async function suggestionsForContact(ctx: Ctx, contactId: string) {
  return await all<{ id: string; rule_id: RuleKey; status: string; status_reason: string | null; facts: string; created_at: string; snoozed_until: string | null }>(
    "SELECT id, rule_id, status, status_reason, facts, created_at, snoozed_until FROM suggestions WHERE contact_id = ? AND studio_id = ? ORDER BY created_at DESC LIMIT 30",
    contactId,
    ctx.studio.id,
  );
}
