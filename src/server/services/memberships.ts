import { all, one, run, tx } from "../db";
import { AppError, conflict, invalid, notFound } from "../errors";
import { assertCan, type Ctx } from "../permissions";
import { audit } from "../audit";
import { id, nowIso } from "../util";
import { endDateToExclusive, localDate, startOfLocalDay, addLocalDays } from "../time";
import { getContact, invalidateDrafts } from "./contacts";

export type PlanType = "period" | "punch" | "punch_period" | "trial";

export type Plan = {
  id: string;
  studio_id: string;
  name: string;
  type: PlanType;
  sessions_granted: number | null;
  validity_days: number | null;
  price: string | null;
  deducts: number;
  active: number;
};

export type MembershipStatus = "pending" | "active" | "paused" | "expired" | "exhausted" | "cancelled";

export type MembershipRow = {
  id: string;
  studio_id: string;
  contact_id: string;
  plan_id: string;
  authority: "local" | "external";
  external_id: string | null;
  starts_at: string;
  ends_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  renewed_from: string | null;
  reference: string | null;
  source_updated_at: string | null;
  external_balance: number | null;
  version: number;
  created_at: string;
};

export type MembershipView = MembershipRow & {
  plan_name: string;
  plan_type: PlanType;
  plan_deducts: number;
  sessions_granted: number | null;
  balance: number | null;
  used: number;
  status: MembershipStatus;
  reasons: MembershipStatus[];
  eligible: boolean;
  paused_now: boolean;
  pauses: { id: string; starts_at: string; ends_at: string; reason: string | null }[];
  contact_name?: string;
};

export function listPlans(studioId: string, includeInactive = false): Plan[] {
  return all<Plan>(
    `SELECT * FROM plans WHERE studio_id = ? ${includeInactive ? "" : "AND active = 1"} ORDER BY active DESC, name`,
    studioId,
  );
}

export function savePlan(
  ctx: Ctx,
  input: { id?: string; name?: string; type?: PlanType; sessions_granted?: number | null; validity_days?: number | null; price?: string | null; active?: boolean },
) {
  assertCan(ctx, "memberships.manage");
  const fields: Record<string, string> = {};
  const name = (input.name ?? "").trim();
  if (!name) fields.name = "צריך שם למסלול.";
  const type = input.type;
  if (!type || !["period", "punch", "punch_period", "trial"].includes(type)) fields.type = "בחרו סוג מסלול.";
  const needsSessions = type === "punch" || type === "punch_period";
  const sessions = input.sessions_granted ? Math.floor(Number(input.sessions_granted)) : null;
  if (needsSessions && (!sessions || sessions < 1 || sessions > 1000)) fields.sessions_granted = "כמה שיעורים בכרטיסייה?";
  const validity = input.validity_days ? Math.floor(Number(input.validity_days)) : null;
  if ((type === "period" || type === "punch_period" || type === "trial") && (!validity || validity < 1 || validity > 3650)) {
    fields.validity_days = "לכמה ימים המסלול תקף?";
  }
  if (Object.keys(fields).length) throw invalid(fields);
  const now = nowIso();
  if (input.id) {
    const res = run(
      "UPDATE plans SET name = ?, type = ?, sessions_granted = ?, validity_days = ?, price = ?, active = ?, updated_at = ? WHERE id = ? AND studio_id = ?",
      name,
      type,
      needsSessions ? sessions : type === "trial" ? sessions ?? 1 : null,
      validity,
      input.price?.trim() || null,
      input.active === false ? 0 : 1,
      now,
      input.id,
      ctx.studio.id,
    );
    if (!res.changes) throw notFound("המסלול");
    return input.id;
  }
  const planId = id("pln");
  run(
    "INSERT INTO plans (id, studio_id, name, type, sessions_granted, validity_days, price, deducts, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)",
    planId,
    ctx.studio.id,
    name,
    type,
    needsSessions ? sessions : type === "trial" ? sessions ?? 1 : null,
    validity,
    input.price?.trim() || null,
    type === "period" ? 0 : 1,
    now,
    now,
  );
  return planId;
}

type Row = MembershipRow & { plan_name: string; plan_type: PlanType; plan_deducts: number; sessions_granted: number | null; contact_name?: string };

/** MEM-02 status precedence: cancelled, expired, paused, pending, exhausted, active. */
export function computeStatus(m: Row, balance: number | null, pauses: { starts_at: string; ends_at: string }[], at = nowIso()) {
  const reasons: MembershipStatus[] = [];
  if (m.cancelled_at && m.cancelled_at <= at) reasons.push("cancelled");
  if (m.ends_at && m.ends_at <= at) reasons.push("expired");
  const pausedNow = pauses.some((p) => p.starts_at <= at && p.ends_at > at);
  if (pausedNow) reasons.push("paused");
  if (m.starts_at > at) reasons.push("pending");
  const usesBalance = m.plan_type === "punch" || m.plan_type === "punch_period" || m.plan_type === "trial";
  if (usesBalance && balance !== null && balance <= 0) reasons.push("exhausted");
  const status: MembershipStatus = reasons[0] ?? "active";
  return { status, reasons: reasons.length ? reasons : (["active"] as MembershipStatus[]), pausedNow, eligible: status === "active" };
}

export function balanceOf(membershipId: string): number {
  return one<{ b: number }>("SELECT COALESCE(SUM(delta), 0) AS b FROM balance_entries WHERE membership_id = ?", membershipId)!.b;
}

function usedOf(membershipId: string): number {
  return one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM balance_entries d WHERE d.membership_id = ? AND d.kind = 'deduction' AND NOT EXISTS (SELECT 1 FROM balance_entries r WHERE r.reverses_id = d.id)",
    membershipId,
  )!.n;
}

function view(row: Row, at?: string): MembershipView {
  const usesBalance = row.plan_type !== "period";
  const balance = !usesBalance ? null : row.authority === "local" ? balanceOf(row.id) : row.external_balance;
  const pauses = all<{ id: string; starts_at: string; ends_at: string; reason: string | null }>(
    "SELECT id, starts_at, ends_at, reason FROM membership_pauses WHERE membership_id = ? ORDER BY starts_at DESC",
    row.id,
  );
  const s = computeStatus(row, balance, pauses, at);
  return { ...row, balance, used: usedOf(row.id), status: s.status, reasons: s.reasons, eligible: s.eligible, paused_now: s.pausedNow, pauses };
}

const BASE = `SELECT m.*, p.name AS plan_name, p.type AS plan_type, p.deducts AS plan_deducts, p.sessions_granted, c.display_name AS contact_name
  FROM memberships m JOIN plans p ON p.id = m.plan_id JOIN contacts c ON c.id = m.contact_id`;

export function membershipsForContact(studioId: string, contactId: string): MembershipView[] {
  return all<Row>(`${BASE} WHERE m.contact_id = ? AND m.studio_id = ? ORDER BY m.starts_at DESC`, contactId, studioId).map((r) => view(r));
}

export function getMembership(studioId: string, membershipId: string): MembershipView {
  const row = one<Row>(`${BASE} WHERE m.id = ? AND m.studio_id = ?`, membershipId, studioId);
  if (!row) throw notFound("המנוי");
  return view(row);
}

export function listMemberships(
  ctx: Ctx,
  f: { status?: string; q?: string; plan?: string; page?: number },
): { items: MembershipView[]; total: number } {
  assertCan(ctx, "memberships.view");
  const where = ["m.studio_id = ?", "c.merged_into IS NULL"];
  const params: unknown[] = [ctx.studio.id];
  if (f.q?.trim()) {
    where.push("c.display_name LIKE ?");
    params.push(`%${f.q.trim()}%`);
  }
  if (f.plan) {
    where.push("m.plan_id = ?");
    params.push(f.plan);
  }
  const rows = all<Row>(`${BASE} WHERE ${where.join(" AND ")} ORDER BY COALESCE(m.ends_at, '9999') ASC LIMIT 2000`, ...params).map((r) => view(r));
  let items = rows;
  if (f.status === "ending") {
    const soon = new Date(Date.now() + 7 * 86_400_000).toISOString();
    items = rows.filter((m) => m.status === "active" && ((m.ends_at && m.ends_at <= soon) || (m.balance !== null && m.balance <= 2)));
  } else if (f.status) items = rows.filter((m) => m.status === f.status);
  else items = rows.filter((m) => m.status !== "cancelled" && m.status !== "expired").concat(rows.filter((m) => m.status === "expired" || m.status === "cancelled"));
  const page = Math.max(1, f.page ?? 1);
  return { items: items.slice((page - 1) * 50, page * 50), total: items.length };
}

/** Membership the attendance should use: staff choice, or the single eligible one (MEM-01). */
export function eligibleMemberships(studioId: string, contactId: string, at?: string): MembershipView[] {
  return membershipsForContact(studioId, contactId).filter((m) => computeStatus(m, m.balance, m.pauses, at).eligible);
}

export function createMembership(
  ctx: Ctx,
  input: { contact_id?: string; plan_id?: string; start_date?: string; end_date?: string | null; sessions?: number | null; reference?: string | null; renewed_from?: string | null },
) {
  assertCan(ctx, "memberships.manage");
  const fields: Record<string, string> = {};
  if (!input.contact_id) fields.contact_id = "בחרו לקוח.";
  if (!input.plan_id) fields.plan_id = "בחרו מסלול.";
  if (!input.start_date || !/^\d{4}-\d{2}-\d{2}$/.test(input.start_date)) fields.start_date = "בחרו תאריך התחלה.";
  if (Object.keys(fields).length) throw invalid(fields);
  const contact = getContact(ctx, input.contact_id!);
  const plan = one<Plan>("SELECT * FROM plans WHERE id = ? AND studio_id = ?", input.plan_id, ctx.studio.id);
  if (!plan) throw invalid({ plan_id: "המסלול לא נמצא." });
  const tz = ctx.studio.timezone;
  const startsAt = startOfLocalDay(input.start_date!, tz).toISOString();
  let endDate = input.end_date || null;
  if (!endDate && plan.validity_days) endDate = addLocalDays(input.start_date!, plan.validity_days - 1);
  if (endDate && endDate < input.start_date!) throw invalid({ end_date: "תאריך הסיום לפני ההתחלה." });
  const endsAt = endDate ? endDateToExclusive(endDate, tz) : null;
  const sessions = plan.type === "period" ? null : Math.floor(Number(input.sessions ?? plan.sessions_granted ?? 1));
  if (sessions !== null && (!sessions || sessions < 1)) throw invalid({ sessions: "מספר שיעורים לא תקין." });
  if (input.renewed_from) {
    const prev = one("SELECT 1 FROM memberships WHERE id = ? AND contact_id = ? AND studio_id = ?", input.renewed_from, contact.id, ctx.studio.id);
    if (!prev) throw invalid({ renewed_from: "המנוי הקודם לא נמצא." });
  }
  const now = nowIso();
  const membershipId = id("mem");
  tx(() => {
    run(
      `INSERT INTO memberships (id, studio_id, contact_id, plan_id, authority, starts_at, ends_at, renewed_from, reference, created_by, created_at, updated_at)
       VALUES (?,?,?,?, 'local', ?,?,?,?,?,?,?)`,
      membershipId,
      ctx.studio.id,
      contact.id,
      plan.id,
      startsAt,
      endsAt,
      input.renewed_from ?? null,
      input.reference?.trim() || null,
      ctx.userId,
      now,
      now,
    );
    if (sessions !== null) {
      run(
        "INSERT INTO balance_entries (id, studio_id, membership_id, kind, delta, reason, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
        id("bal"),
        ctx.studio.id,
        membershipId,
        "grant",
        sessions,
        "הקצאת שיעורים",
        ctx.userId,
        now,
      );
    }
    if (plan.type !== "trial" && ["new_lead", "contacted", "trial_scheduled", "trial_attended", "decision_pending", "lost"].includes(contact.pipeline_stage)) {
      run(
        "UPDATE contacts SET pipeline_stage = 'converted', stage_reason = NULL, version = version + 1, updated_at = ? WHERE id = ?",
        now,
        contact.id,
      );
      run(
        "INSERT INTO stage_changes (id, studio_id, contact_id, from_stage, to_stage, reason, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
        id("stg"),
        ctx.studio.id,
        contact.id,
        contact.pipeline_stage,
        "converted",
        `מנוי: ${plan.name}`,
        ctx.userId,
        now,
      );
    }
    if (input.renewed_from || plan.type !== "trial") {
      run(
        "INSERT INTO interaction_events (id, studio_id, contact_id, channel, event_type, evidence_type, note, occurred_at, actor_id) VALUES (?,?,?,?,?,?,?,?,?)",
        id("evt"),
        ctx.studio.id,
        contact.id,
        "system",
        input.renewed_from ? "renewal" : "membership_created",
        "membership_record",
        plan.name,
        now,
        ctx.userId,
      );
    }
    // A documented renewal cancels stale renewal reasons and their drafts (AC-07).
    run(
      "UPDATE suggestions SET status = 'superseded', status_reason = 'renewed', updated_at = ? WHERE contact_id = ? AND studio_id = ? AND rule_id IN ('R03','R04','R07','R02') AND status IN ('active','snoozed')",
      now,
      contact.id,
      ctx.studio.id,
    );
    run(
      "UPDATE tasks SET status = 'superseded', version = version + 1, updated_at = ? WHERE contact_id = ? AND studio_id = ? AND reason_code IN ('R03','R04','R07','R02') AND status IN ('open','in_progress','snoozed')",
      now,
      contact.id,
      ctx.studio.id,
    );
    invalidateDrafts(ctx.studio.id, contact.id, "membership_changed");
    audit({ studioId: ctx.studio.id, actorId: ctx.userId, action: input.renewed_from ? "membership.renewed" : "membership.created", entity: "membership", entityId: membershipId, diff: { plan: plan.name, sessions, start: input.start_date, end: endDate } });
  });
  return getMembership(ctx.studio.id, membershipId);
}

export function adjustBalance(ctx: Ctx, membershipId: string, delta: number, reason: string) {
  assertCan(ctx, "balance.adjust");
  const m = getMembership(ctx.studio.id, membershipId);
  if (m.authority !== "local") throw new AppError("blocked", "היתרה מנוהלת במערכת חיצונית ולא ניתן לשנות אותה כאן.");
  if (m.balance === null) throw new AppError("blocked", "למסלול הזה אין יתרת שיעורים.");
  const d = Math.trunc(Number(delta));
  if (!d || Math.abs(d) > 500) throw invalid({ delta: "בחרו כמה שיעורים להוסיף או להוריד." });
  if (!reason?.trim()) throw invalid({ reason: "כתבו סיבה להתאמה." });
  if (m.balance + d < 0) throw invalid({ delta: "היתרה לא יכולה לרדת מתחת לאפס." });
  tx(() => {
    run(
      "INSERT INTO balance_entries (id, studio_id, membership_id, kind, delta, reason, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
      id("bal"),
      ctx.studio.id,
      membershipId,
      "adjustment",
      d,
      reason.trim(),
      ctx.userId,
      nowIso(),
    );
    audit({ studioId: ctx.studio.id, actorId: ctx.userId, action: "balance.adjusted", entity: "membership", entityId: membershipId, reason: reason.trim(), diff: { delta: d, before: m.balance, after: (m.balance ?? 0) + d } });
    invalidateDrafts(ctx.studio.id, m.contact_id, "membership_changed");
  });
  return getMembership(ctx.studio.id, membershipId);
}

export function pauseMembership(ctx: Ctx, membershipId: string, startDate: string, endDate: string, reason: string, extend: boolean) {
  assertCan(ctx, "memberships.manage");
  const m = getMembership(ctx.studio.id, membershipId);
  if (m.status === "cancelled" || m.status === "expired") throw new AppError("blocked", "אי אפשר להקפיא מנוי שהסתיים.");
  const tz = ctx.studio.timezone;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) {
    throw invalid({ end_date: "בחרו טווח תאריכים תקין." });
  }
  const startsAt = startOfLocalDay(startDate, tz).toISOString();
  const endsAt = endDateToExclusive(endDate, tz);
  const days = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 86_400_000);
  tx(() => {
    run(
      "INSERT INTO membership_pauses (id, studio_id, membership_id, starts_at, ends_at, reason, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
      id("pau"),
      ctx.studio.id,
      membershipId,
      startsAt,
      endsAt,
      reason?.trim() || null,
      ctx.userId,
      nowIso(),
    );
    // Extension of the end date is an explicit owner choice (D07), never automatic.
    if (extend && m.ends_at) {
      run(
        "UPDATE memberships SET ends_at = ?, version = version + 1, updated_at = ? WHERE id = ?",
        new Date(Date.parse(m.ends_at) + days * 86_400_000).toISOString(),
        nowIso(),
        membershipId,
      );
    }
    audit({ studioId: ctx.studio.id, actorId: ctx.userId, action: "membership.paused", entity: "membership", entityId: membershipId, reason, diff: { startDate, endDate, extendedDays: extend ? days : 0 } });
    invalidateDrafts(ctx.studio.id, m.contact_id, "membership_changed");
  });
  return getMembership(ctx.studio.id, membershipId);
}

export function cancelMembership(ctx: Ctx, membershipId: string, version: number, reason: string) {
  assertCan(ctx, "memberships.manage");
  const m = getMembership(ctx.studio.id, membershipId);
  if (!reason?.trim()) throw invalid({ reason: "כתבו סיבה לביטול." });
  if (m.version !== version) throw conflict();
  tx(() => {
    const res = run(
      "UPDATE memberships SET cancelled_at = ?, cancel_reason = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND cancelled_at IS NULL",
      nowIso(),
      reason.trim(),
      nowIso(),
      membershipId,
      version,
    );
    if (res.changes !== 1) throw conflict();
    audit({ studioId: ctx.studio.id, actorId: ctx.userId, action: "membership.cancelled", entity: "membership", entityId: membershipId, reason });
    invalidateDrafts(ctx.studio.id, m.contact_id, "membership_changed");
  });
  return getMembership(ctx.studio.id, membershipId);
}

export function balanceLedger(studioId: string, membershipId: string) {
  return all<{ id: string; kind: string; delta: number; reason: string | null; created_at: string; actor: string | null; attendance_id: string | null; session_title: string | null }>(
    `SELECT b.id, b.kind, b.delta, b.reason, b.created_at, u.name AS actor, b.attendance_id, cs.title AS session_title
       FROM balance_entries b
       LEFT JOIN users u ON u.id = b.created_by
       LEFT JOIN attendance a ON a.id = b.attendance_id
       LEFT JOIN class_sessions cs ON cs.id = a.session_id
      WHERE b.membership_id = ? AND b.studio_id = ? ORDER BY b.created_at DESC`,
    membershipId,
    studioId,
  );
}

export function membershipLocalDates(m: MembershipRow, tz: string) {
  return {
    start: localDate(m.starts_at, tz),
    end: m.ends_at ? localDate(new Date(Date.parse(m.ends_at) - 1), tz) : null,
  };
}
