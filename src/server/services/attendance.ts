// Class sessions, attendance, balance deductions and QR check-in (spec §19–§20, QR-02/03/04).

import { all, one, run, tx } from "../db";
import { AppError, conflict, invalid, notFound } from "../errors";
import { assertCan, can, type Ctx } from "../permissions";
import type { Studio } from "../studio";
import { addMinutes, id, nowIso, sha256, token } from "../util";
import { audit } from "../audit";
import { eligibleMemberships, getMembership, type MembershipView } from "./memberships";
import { localDateTimeToUtc } from "../time";
import { markEvaluationStale } from "./followups";

export type SessionRow = {
  id: string;
  studio_id: string;
  title: string;
  trainer_id: string | null;
  trainer_name: string | null;
  start_at: string;
  end_at: string;
  status: "scheduled" | "open" | "completed" | "cancelled";
  cancel_reason: string | null;
  version: number;
  attendance_count: number;
};

const SELECT = `SELECT s.*, u.name AS trainer_name,
  (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status <> 'reversed') AS attendance_count
  FROM class_sessions s LEFT JOIN users u ON u.id = s.trainer_id`;

/** Instructors only see sessions assigned to them or unassigned (spec §06 "authorized classes"). */
function sessionScope(ctx: Ctx): { sql: string; params: unknown[] } {
  if (ctx.role === "instructor") return { sql: "(s.trainer_id = ? OR s.trainer_id IS NULL)", params: [ctx.userId] };
  return { sql: "1=1", params: [] };
}

export function listSessions(ctx: Ctx, fromIso: string, toIso: string): SessionRow[] {
  assertCan(ctx, "attendance.record");
  const scope = sessionScope(ctx);
  return all<SessionRow>(
    `${SELECT} WHERE s.studio_id = ? AND s.start_at >= ? AND s.start_at < ? AND ${scope.sql} ORDER BY s.start_at`,
    ctx.studio.id,
    fromIso,
    toIso,
    ...scope.params,
  ).map((s) => withEffectiveStatus(s));
}

export function getSession(ctx: Ctx, sessionId: string): SessionRow {
  assertCan(ctx, "attendance.record");
  const scope = sessionScope(ctx);
  const s = one<SessionRow>(`${SELECT} WHERE s.id = ? AND s.studio_id = ? AND ${scope.sql}`, sessionId, ctx.studio.id, ...scope.params);
  if (!s) throw notFound("השיעור");
  return withEffectiveStatus(s);
}

/** A scheduled session past its end is shown as completed. */
function withEffectiveStatus(s: SessionRow): SessionRow {
  if ((s.status === "scheduled" || s.status === "open") && s.end_at < addMinutes(nowIso(), -60)) return { ...s, status: "completed" };
  return s;
}

export function checkinWindow(studio: Studio, s: { start_at: string }) {
  return {
    opensAt: addMinutes(s.start_at, -studio.settings.checkinWindowBeforeMin),
    closesAt: addMinutes(s.start_at, studio.settings.checkinWindowAfterMin),
  };
}

export function saveSession(
  ctx: Ctx,
  input: { id?: string; title?: string; date?: string; start?: string; end?: string; trainer_id?: string | null; version?: number; change_reason?: string; repeat_weeks?: number },
) {
  assertCan(ctx, "sessions.manage");
  const fields: Record<string, string> = {};
  const title = (input.title ?? "").trim();
  if (!title) fields.title = "צריך שם לשיעור.";
  if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) fields.date = "בחרו תאריך.";
  if (!input.start || !/^\d{2}:\d{2}$/.test(input.start)) fields.start = "בחרו שעת התחלה.";
  if (!input.end || !/^\d{2}:\d{2}$/.test(input.end)) fields.end = "בחרו שעת סיום.";
  if (input.start && input.end && input.end <= input.start) fields.end = "הסיום צריך להיות אחרי ההתחלה.";
  if (Object.keys(fields).length) throw invalid(fields);
  if (input.trainer_id && !one("SELECT 1 FROM staff_memberships WHERE studio_id = ? AND user_id = ? AND active = 1", ctx.studio.id, input.trainer_id)) {
    throw invalid({ trainer_id: "המדריך/ה לא בצוות." });
  }
  const tz = ctx.studio.timezone;
  const startAt = localDateTimeToUtc(input.date!, input.start!, tz);
  const endAt = localDateTimeToUtc(input.date!, input.end!, tz);
  const now = nowIso();
  if (input.id) {
    const current = getSession(ctx, input.id);
    if (input.version !== current.version) throw conflict();
    const timesChanged = current.start_at !== startAt || current.end_at !== endAt;
    if (timesChanged && current.start_at < now && !input.change_reason?.trim()) {
      throw invalid({ change_reason: "השיעור כבר התקיים. כתבו למה משנים את השעות." });
    }
    tx(() => {
      const res = run(
        "UPDATE class_sessions SET title = ?, start_at = ?, end_at = ?, trainer_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND studio_id = ? AND version = ?",
        title,
        startAt,
        endAt,
        input.trainer_id || null,
        now,
        input.id,
        ctx.studio.id,
        input.version,
      );
      if (res.changes !== 1) throw conflict();
      if (timesChanged) {
        audit({ studioId: ctx.studio.id, actorId: ctx.userId, action: "session.rescheduled", entity: "class_session", entityId: input.id, reason: input.change_reason ?? null, diff: { start: [current.start_at, startAt], end: [current.end_at, endAt] } });
      }
    });
    return getSession(ctx, input.id!);
  }
  const weeks = Math.min(Math.max(Math.floor(input.repeat_weeks ?? 1), 1), 26);
  let firstId = "";
  tx(() => {
    for (let w = 0; w < weeks; w++) {
      const sid = id("cls");
      if (!firstId) firstId = sid;
      run(
        "INSERT INTO class_sessions (id, studio_id, title, trainer_id, start_at, end_at, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?, 'scheduled', ?,?,?)",
        sid,
        ctx.studio.id,
        title,
        input.trainer_id || null,
        new Date(Date.parse(startAt) + w * 7 * 86_400_000).toISOString(),
        new Date(Date.parse(endAt) + w * 7 * 86_400_000).toISOString(),
        ctx.userId,
        now,
        now,
      );
    }
  });
  return getSession(ctx, firstId);
}

export function setSessionOpen(ctx: Ctx, sessionId: string, open: boolean) {
  assertCan(ctx, "attendance.record");
  const s = getSession(ctx, sessionId);
  if (s.status === "cancelled") throw new AppError("blocked", "השיעור בוטל.");
  run("UPDATE class_sessions SET status = ?, version = version + 1, updated_at = ? WHERE id = ?", open ? "open" : "completed", nowIso(), sessionId);
  if (!open) run("UPDATE qr_challenges SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL", nowIso(), sessionId);
  return getSession(ctx, sessionId);
}

export function cancelSession(ctx: Ctx, sessionId: string, reason: string, version: number) {
  assertCan(ctx, "sessions.manage");
  const s = getSession(ctx, sessionId);
  if (!reason?.trim()) throw invalid({ reason: "כתבו סיבה לביטול." });
  if (s.version !== version) throw conflict();
  if (s.status === "cancelled") return s;
  const now = nowIso();
  tx(() => {
    run("UPDATE class_sessions SET status = 'cancelled', cancel_reason = ?, version = version + 1, updated_at = ? WHERE id = ?", reason.trim(), now, sessionId);
    run("UPDATE qr_challenges SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL", now, sessionId);
    // Policy: attendance of a cancelled class is reversed and local deductions returned once.
    for (const a of all<{ id: string }>("SELECT id FROM attendance WHERE session_id = ? AND status <> 'reversed'", sessionId)) {
      reverseRaw(ctx.studio.id, a.id, `השיעור בוטל: ${reason.trim()}`, ctx.userId);
    }
    audit({ studioId: ctx.studio.id, actorId: ctx.userId, action: "session.cancelled", entity: "class_session", entityId: sessionId, reason });
  });
  markEvaluationStale(ctx.studio.id);
  return getSession(ctx, sessionId);
}

export type RosterRow = {
  id: string;
  contact_id: string;
  contact_name: string;
  membership_id: string | null;
  plan_name: string | null;
  status: string;
  channel: string;
  checked_in_at: string;
  actor_name: string | null;
  reversal_reason: string | null;
  version: number;
};

export function roster(ctx: Ctx, sessionId: string): RosterRow[] {
  getSession(ctx, sessionId);
  return all<RosterRow>(
    `SELECT a.id, a.contact_id, c.display_name AS contact_name, a.membership_id, p.name AS plan_name, a.status, a.channel, a.checked_in_at,
            u.name AS actor_name, a.reversal_reason, a.version
       FROM attendance a JOIN contacts c ON c.id = a.contact_id
       LEFT JOIN memberships m ON m.id = a.membership_id LEFT JOIN plans p ON p.id = m.plan_id
       LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.session_id = ? AND a.studio_id = ? ORDER BY a.checked_in_at`,
    sessionId,
    ctx.studio.id,
  );
}

export type CheckInResult = {
  status: "checked_in" | "already_recorded";
  attendance_id: string;
  already_recorded: boolean;
  balance_authority: "local" | "external" | "none";
  attendance_status: string;
  session_title: string;
  checked_in_at: string;
  plan_name: string | null;
  balance: number | null;
};

/**
 * Atomic check-in (QR-02 step 4): one attendance per person+session, at most one
 * deduction, and only for local balance plans. Repeats return the same result.
 */
export function commitCheckIn(
  studio: Studio,
  p: { contactId: string; sessionId: string; membershipId?: string | null; noMembership?: boolean; channel: "qr" | "manual"; actorId: string | null; note?: string | null },
): CheckInResult {
  return tx(() => {
    const session = one<{ id: string; title: string; status: string; start_at: string }>(
      "SELECT id, title, status, start_at FROM class_sessions WHERE id = ? AND studio_id = ?",
      p.sessionId,
      studio.id,
    );
    if (!session) throw notFound("השיעור");
    if (session.status === "cancelled") throw new AppError("blocked", "השיעור בוטל.");
    const contact = one<{ id: string; pipeline_stage: string; display_name: string }>(
      "SELECT id, pipeline_stage, display_name FROM contacts WHERE id = ? AND studio_id = ? AND merged_into IS NULL",
      p.contactId,
      studio.id,
    );
    if (!contact) throw notFound("הלקוח");

    const existing = one<{ id: string; status: string; checked_in_at: string; membership_id: string | null }>(
      "SELECT id, status, checked_in_at, membership_id FROM attendance WHERE studio_id = ? AND contact_id = ? AND session_id = ?",
      studio.id,
      contact.id,
      session.id,
    );
    if (existing) {
      if (existing.status === "reversed") throw new AppError("blocked", "הנוכחות בשיעור הזה בוטלה בעבר. פנו לבעלי הסטודיו לרישום מחדש.");
      const m = existing.membership_id ? getMembership(studio.id, existing.membership_id) : null;
      return {
        status: "already_recorded",
        attendance_id: existing.id,
        already_recorded: true,
        balance_authority: m ? m.authority : "none",
        attendance_status: existing.status,
        session_title: session.title,
        checked_in_at: existing.checked_in_at,
        plan_name: m?.plan_name ?? null,
        balance: m?.balance ?? null,
      };
    }

    let membership: MembershipView | null = null;
    const eligible = eligibleMemberships(studio.id, contact.id);
    if (p.membershipId) {
      membership = eligible.find((m) => m.id === p.membershipId) ?? null;
      if (!membership) throw new AppError("blocked", "המנוי שנבחר אינו זכאי כרגע (פג תוקף, מוקפא או שנגמרה היתרה).");
    } else if (!p.noMembership) {
      if (!eligible.length) throw new AppError("blocked", "אין מנוי בתוקף. גשו לקבלה.", { details: { reason: "not_eligible" } });
      // Several eligible memberships: use the one that ends first (staff can change it later).
      membership = [...eligible].sort((a, b) => (a.ends_at ?? "9999").localeCompare(b.ends_at ?? "9999"))[0];
    }

    const now = nowIso();
    const attendanceId = id("att");
    const external = membership?.authority === "external";
    const deducts = !!membership && !external && membership.plan_type !== "period" && membership.plan_deducts === 1;
    if (deducts && (membership!.balance ?? 0) <= 0) throw new AppError("blocked", "נגמרה היתרה במנוי. גשו לקבלה.");
    run(
      `INSERT INTO attendance (id, studio_id, contact_id, session_id, membership_id, status, channel, checked_in_at, actor_id, note)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      attendanceId,
      studio.id,
      contact.id,
      session.id,
      membership?.id ?? null,
      external ? "pending_reconciliation" : "present",
      p.channel,
      now,
      p.actorId,
      p.note?.trim() || null,
    );
    if (deducts) {
      run(
        "INSERT INTO balance_entries (id, studio_id, membership_id, kind, delta, attendance_id, reason, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        id("bal"),
        studio.id,
        membership!.id,
        "deduction",
        -1,
        attendanceId,
        session.title,
        p.actorId,
        now,
      );
    }
    run(
      "INSERT INTO interaction_events (id, studio_id, contact_id, channel, event_type, evidence_type, note, occurred_at, actor_id) VALUES (?,?,?,?,?,?,?,?,?)",
      id("evt"),
      studio.id,
      contact.id,
      p.channel,
      "attendance",
      p.channel === "qr" ? "qr_session" : "staff_entry",
      session.title,
      now,
      p.actorId,
    );
    const trialLike = !membership || membership.plan_type === "trial";
    if (trialLike && ["new_lead", "contacted", "trial_scheduled", "decision_pending"].includes(contact.pipeline_stage)) {
      run("UPDATE contacts SET pipeline_stage = 'trial_attended', version = version + 1, updated_at = ? WHERE id = ?", now, contact.id);
      run(
        "INSERT INTO stage_changes (id, studio_id, contact_id, from_stage, to_stage, reason, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
        id("stg"),
        studio.id,
        contact.id,
        contact.pipeline_stage,
        "trial_attended",
        session.title,
        p.actorId,
        now,
      );
    }
    markEvaluationStale(studio.id);
    return {
      status: "checked_in",
      attendance_id: attendanceId,
      already_recorded: false,
      balance_authority: membership ? membership.authority : "none",
      attendance_status: external ? "pending_reconciliation" : "present",
      session_title: session.title,
      checked_in_at: now,
      plan_name: membership?.plan_name ?? null,
      balance: deducts ? (membership!.balance ?? 0) - 1 : membership?.balance ?? null,
    };
  });
}

export function manualCheckIn(
  ctx: Ctx,
  input: { session_id: string; contact_id?: string; membership_id?: string | null; no_membership?: boolean; late_reason?: string },
) {
  assertCan(ctx, "attendance.record");
  const s = getSession(ctx, input.session_id);
  if (!input.contact_id) throw invalid({ contact_id: "בחרו לקוח." });
  if (s.status === "completed" && !input.late_reason?.trim()) {
    throw invalid({ late_reason: "השיעור כבר הסתיים. כתבו סיבה לרישום מאוחר." });
  }
  const result = commitCheckIn(ctx.studio, {
    contactId: input.contact_id,
    sessionId: s.id,
    membershipId: input.membership_id ?? null,
    noMembership: !!input.no_membership,
    channel: "manual",
    actorId: ctx.userId,
    note: input.late_reason ?? null,
  });
  if (input.late_reason?.trim() && !result.already_recorded) {
    audit({ studioId: ctx.studio.id, actorId: ctx.userId, action: "attendance.late_recorded", entity: "attendance", entityId: result.attendance_id, reason: input.late_reason.trim() });
  }
  return result;
}

function reverseRaw(studioId: string, attendanceId: string, reason: string, actorId: string | null) {
  const a = one<{ id: string; status: string }>("SELECT id, status FROM attendance WHERE id = ? AND studio_id = ?", attendanceId, studioId);
  if (!a) throw notFound("הנוכחות");
  if (a.status === "reversed") return { alreadyReversed: true };
  const now = nowIso();
  run("UPDATE attendance SET status = 'reversed', reversed_at = ?, reversed_by = ?, reversal_reason = ?, version = version + 1 WHERE id = ?", now, actorId, reason, attendanceId);
  const deduction = one<{ id: string; membership_id: string }>(
    "SELECT id, membership_id FROM balance_entries WHERE attendance_id = ? AND kind = 'deduction'",
    attendanceId,
  );
  if (deduction) {
    // The unique index on reverses_id guarantees a single refund (AC-Q06).
    run(
      "INSERT OR IGNORE INTO balance_entries (id, studio_id, membership_id, kind, delta, attendance_id, reverses_id, reason, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      id("bal"),
      studioId,
      deduction.membership_id,
      "reversal",
      1,
      null,
      deduction.id,
      reason,
      actorId,
      now,
    );
  }
  audit({ studioId, actorId, action: "attendance.reversed", entity: "attendance", entityId: attendanceId, reason });
  return { alreadyReversed: false };
}

export function reverseAttendance(ctx: Ctx, attendanceId: string, reason: string, version?: number) {
  assertCan(ctx, "attendance.correct");
  if (!reason?.trim()) throw invalid({ reason: "כתבו סיבה לביטול הנוכחות." });
  const a = one<{ id: string; session_id: string; version: number; status: string }>(
    "SELECT id, session_id, version, status FROM attendance WHERE id = ? AND studio_id = ?",
    attendanceId,
    ctx.studio.id,
  );
  if (!a) throw notFound("הנוכחות");
  getSession(ctx, a.session_id);
  if (a.status === "reversed") return { status: "already_reversed" as const };
  if (version !== undefined && version !== a.version) throw conflict();
  tx(() => reverseRaw(ctx.studio.id, attendanceId, reason.trim(), ctx.userId));
  markEvaluationStale(ctx.studio.id);
  return { status: "reversed" as const };
}

// ---------------------------------------------------------------------------
// QR challenges: short-lived random token bound to studio + session; no PII.

export function issueChallenge(ctx: Ctx, sessionId: string) {
  assertCan(ctx, "attendance.record");
  const s = getSession(ctx, sessionId);
  if (s.status === "cancelled") throw new AppError("blocked", "השיעור בוטל.");
  if (s.status === "completed") throw new AppError("blocked", "השיעור הסתיים. אפשר לרשום נוכחות ידנית.");
  const now = nowIso();
  if (s.status === "scheduled") run("UPDATE class_sessions SET status = 'open', version = version + 1, updated_at = ? WHERE id = ?", now, s.id);
  const raw = token(18);
  const rotate = ctx.studio.settings.qrRotateSeconds;
  // Small grace so a code scanned right before rotation still works.
  const expires = new Date(Date.now() + (rotate + 15) * 1000).toISOString();
  run("INSERT INTO qr_challenges (id, studio_id, session_id, token_hash, expires_at, created_at) VALUES (?,?,?,?,?,?)", id("qrc"), ctx.studio.id, s.id, sha256(raw), expires, now);
  run("DELETE FROM qr_challenges WHERE expires_at < ?", addMinutes(now, -60));
  const win = checkinWindow(ctx.studio, s);
  return { token: raw, expires_at: expires, rotate_seconds: rotate, window: win, session: getSession(ctx, s.id) };
}

/** Member self check-in: identity from the member session, class from the token (QR-API). */
export function memberCheckIn(studio: Studio, contactId: string, challengeToken: string): CheckInResult {
  if (!challengeToken || challengeToken.length > 100) throw new AppError("validation", "הקוד אינו תקין. סרקו שוב.");
  const ch = one<{ session_id: string; expires_at: string; revoked_at: string | null }>(
    "SELECT session_id, expires_at, revoked_at FROM qr_challenges WHERE token_hash = ? AND studio_id = ?",
    sha256(challengeToken),
    studio.id,
  );
  if (!ch || ch.revoked_at) throw new AppError("blocked", "הקוד אינו תקף לסטודיו הזה. סרקו את הקוד שעל המסך.", { details: { reason: "invalid_code" } });
  // If already recorded for this class, return the same result even after the code rotated.
  const already = one<{ id: string }>("SELECT id FROM attendance WHERE studio_id = ? AND contact_id = ? AND session_id = ? AND status <> 'reversed'", studio.id, contactId, ch.session_id);
  if (!already && ch.expires_at < nowIso()) throw new AppError("blocked", "הקוד פג תוקף. סרקו שוב את הקוד שעל המסך.", { details: { reason: "expired" } });
  const s = one<{ start_at: string; status: string }>("SELECT start_at, status FROM class_sessions WHERE id = ?", ch.session_id)!;
  const win = checkinWindow(studio, s);
  const now = nowIso();
  if (!already && (now < win.opensAt || now > win.closesAt)) {
    throw new AppError("blocked", "הרישום לשיעור הזה סגור כרגע. גשו לקבלה.", { details: { reason: "window_closed" } });
  }
  return commitCheckIn(studio, { contactId, sessionId: ch.session_id, channel: "qr", actorId: null });
}

export function attendanceForContact(studioId: string, contactId: string) {
  return all<{ id: string; session_title: string; start_at: string; status: string; channel: string; checked_in_at: string; plan_name: string | null }>(
    `SELECT a.id, s.title AS session_title, s.start_at, a.status, a.channel, a.checked_in_at, p.name AS plan_name
       FROM attendance a JOIN class_sessions s ON s.id = a.session_id
       LEFT JOIN memberships m ON m.id = a.membership_id LEFT JOIN plans p ON p.id = m.plan_id
      WHERE a.contact_id = ? AND a.studio_id = ? ORDER BY a.checked_in_at DESC LIMIT 100`,
    contactId,
    studioId,
  );
}

/** Roster CSV for a period (spec: export subject to permission; formula-safe). */
export function exportAttendanceCsv(ctx: Ctx, fromIso: string, toIso: string, sessionId?: string) {
  if (!can(ctx, "export") && !can(ctx, "attendance.correct")) throw new AppError("forbidden", "אין לך הרשאה לייצוא.");
  const rows = all<{ title: string; start_at: string; name: string; status: string; channel: string; checked_in_at: string; plan: string | null }>(
    `SELECT s.title, s.start_at, c.display_name AS name, a.status, a.channel, a.checked_in_at, p.name AS plan
       FROM attendance a JOIN class_sessions s ON s.id = a.session_id JOIN contacts c ON c.id = a.contact_id
       LEFT JOIN memberships m ON m.id = a.membership_id LEFT JOIN plans p ON p.id = m.plan_id
      WHERE a.studio_id = ? AND s.start_at >= ? AND s.start_at < ? ${sessionId ? "AND s.id = ?" : ""}
      ORDER BY s.start_at, c.display_name`,
    ctx.studio.id,
    fromIso,
    toIso,
    ...(sessionId ? [sessionId] : []),
  );
  audit({ studioId: ctx.studio.id, actorId: ctx.userId, action: "attendance.exported", entity: "attendance", diff: { from: fromIso, to: toIso, rows: rows.length } });
  return rows;
}
