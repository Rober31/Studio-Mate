// Tasks and follow-up outcomes (spec §17, FUP-03).

import { all, one, run, tx } from "../db";
import { AppError, conflict, invalid, notFound } from "../errors";
import { assertCan, contactScopeSql, type Ctx } from "../permissions";
import { id, nowIso } from "../util";
import { getContact, setPreferenceRaw, invalidateDrafts } from "./contacts";
import { localDate, startOfLocalDay, addLocalDays } from "../time";
import { audit } from "../audit";

export const OUTCOMES = [
  "no_answer",
  "interested",
  "needs_time",
  "asked_details",
  "wants_trial",
  "renewed",
  "not_interested",
  "stop_contact",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export type TaskRow = {
  id: string;
  contact_id: string;
  contact_name: string;
  contact_phone: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  reason_code: string;
  title: string | null;
  status: "open" | "in_progress" | "snoozed" | "completed" | "dismissed" | "superseded";
  due_at: string;
  snoozed_until: string | null;
  outcome: string | null;
  outcome_note: string | null;
  dismiss_reason: string | null;
  completed_at: string | null;
  version: number;
  created_at: string;
};

const SELECT = `SELECT t.id, t.contact_id, c.display_name AS contact_name, c.phone_e164 AS contact_phone, t.assignee_id, u.name AS assignee_name,
  t.reason_code, t.title, t.status, t.due_at, t.snoozed_until, t.outcome, t.outcome_note, t.dismiss_reason, t.completed_at, t.version, t.created_at
  FROM tasks t JOIN contacts c ON c.id = t.contact_id LEFT JOIN users u ON u.id = t.assignee_id`;

export function getTask(ctx: Ctx, taskId: string): TaskRow {
  const scope = contactScopeSql(ctx);
  const t = one<TaskRow>(`${SELECT} WHERE t.id = ? AND t.studio_id = ? AND ${scope.sql}`, taskId, ctx.studio.id, ...scope.params);
  if (!t) throw notFound("המשימה");
  return t;
}

export function listTasks(ctx: Ctx, view: "today" | "overdue" | "snoozed" | "upcoming" | "done", mine: boolean) {
  assertCan(ctx, "contacts.view");
  const scope = contactScopeSql(ctx);
  const tz = ctx.studio.timezone;
  const today = localDate(new Date(), tz);
  const todayStart = startOfLocalDay(today, tz).toISOString();
  const tomorrowStart = startOfLocalDay(addLocalDays(today, 1), tz).toISOString();
  const where = ["t.studio_id = ?", "c.merged_into IS NULL", scope.sql];
  const params: unknown[] = [ctx.studio.id, ...scope.params];
  if (mine) {
    where.push("t.assignee_id = ?");
    params.push(ctx.userId);
  }
  let order = "t.due_at ASC";
  switch (view) {
    case "today":
      where.push("t.status IN ('open','in_progress') AND t.due_at >= ? AND t.due_at < ?");
      params.push(todayStart, tomorrowStart);
      break;
    case "overdue":
      where.push("t.status IN ('open','in_progress') AND t.due_at < ?");
      params.push(todayStart);
      break;
    case "snoozed":
      where.push("t.status = 'snoozed'");
      order = "t.snoozed_until ASC";
      break;
    case "upcoming":
      where.push("t.status IN ('open','in_progress') AND t.due_at >= ?");
      params.push(tomorrowStart);
      break;
    case "done":
      where.push("t.status IN ('completed','dismissed','superseded')");
      order = "COALESCE(t.completed_at, t.updated_at) DESC";
      break;
  }
  return all<TaskRow>(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 200`, ...params);
}

export function taskCounts(ctx: Ctx) {
  const scope = contactScopeSql(ctx);
  const tz = ctx.studio.timezone;
  const today = localDate(new Date(), tz);
  const todayStart = startOfLocalDay(today, tz).toISOString();
  const tomorrowStart = startOfLocalDay(addLocalDays(today, 1), tz).toISOString();
  const q = (cond: string, ...p: unknown[]) =>
    one<{ n: number }>(`SELECT COUNT(*) AS n FROM tasks t JOIN contacts c ON c.id = t.contact_id WHERE t.studio_id = ? AND c.merged_into IS NULL AND ${scope.sql} AND ${cond}`, ctx.studio.id, ...scope.params, ...p)!.n;
  return {
    today: q("t.status IN ('open','in_progress') AND t.due_at >= ? AND t.due_at < ?", todayStart, tomorrowStart),
    overdue: q("t.status IN ('open','in_progress') AND t.due_at < ?", todayStart),
    snoozed: q("t.status = 'snoozed'"),
    upcoming: q("t.status IN ('open','in_progress') AND t.due_at >= ?", tomorrowStart),
  };
}

export function tasksForContact(ctx: Ctx, contactId: string) {
  getContact(ctx, contactId);
  return all<TaskRow>(`${SELECT} WHERE t.contact_id = ? AND t.studio_id = ? ORDER BY CASE WHEN t.status IN ('open','in_progress','snoozed') THEN 0 ELSE 1 END, t.due_at DESC LIMIT 50`, contactId, ctx.studio.id);
}

export function createTask(ctx: Ctx, input: { contact_id?: string; title?: string; due_at?: string; assignee_id?: string | null; reason_code?: string; reason?: string }) {
  assertCan(ctx, "contacts.edit");
  if (!input.contact_id) throw invalid({ contact_id: "בחרו לקוח." });
  const contact = getContact(ctx, input.contact_id);
  if (!input.due_at || Number.isNaN(Date.parse(input.due_at))) throw invalid({ due_at: "בחרו מועד." });
  const assignee = input.assignee_id === undefined ? contact.owner_id ?? ctx.userId : input.assignee_id;
  if (assignee && !one("SELECT 1 FROM staff_memberships WHERE studio_id = ? AND user_id = ? AND active = 1", ctx.studio.id, assignee)) {
    throw invalid({ assignee_id: "האחראי שנבחר אינו בצוות." });
  }
  const now = nowIso();
  const taskId = id("tsk");
  run(
    `INSERT INTO tasks (id, studio_id, contact_id, assignee_id, reason_code, title, status, due_at, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?, 'open', ?,?,?,?)`,
    taskId,
    ctx.studio.id,
    contact.id,
    assignee,
    input.reason_code || "R06",
    input.title?.trim().slice(0, 200) || null,
    new Date(input.due_at).toISOString(),
    ctx.userId,
    now,
    now,
  );
  if (input.reason?.trim()) {
    audit({ studioId: ctx.studio.id, actorId: ctx.userId, action: "task.override_created", entity: "task", entityId: taskId, reason: input.reason.trim() });
  }
  return getTask(ctx, taskId);
}

export type TaskPatch = {
  version: number;
  action: "start" | "snooze" | "complete" | "dismiss" | "assign" | "reopen" | "edit";
  snoozed_until?: string;
  snooze_reason?: string;
  outcome?: Outcome;
  outcome_note?: string;
  channel?: string;
  dismiss_reason?: string;
  assignee_id?: string | null;
  title?: string;
  due_at?: string;
  follow_up?: { due_at: string; title?: string } | null;
  renewal_reference?: string;
  membership_id?: string;
};

export function updateTask(ctx: Ctx, taskId: string, patch: TaskPatch) {
  assertCan(ctx, "contacts.edit");
  const t = getTask(ctx, taskId);
  if (typeof patch.version !== "number") throw invalid({ version: "חסרה גרסה." });
  if (patch.version !== t.version) {
    throw conflict("מישהו אחר עדכן את המשימה בינתיים. רעננו כדי לראות את המצב העדכני.", { current: t });
  }
  const now = nowIso();
  const apply = (sql: string, ...params: unknown[]) => {
    const res = run(`UPDATE tasks SET ${sql}, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, ...params, now, taskId, patch.version);
    if (res.changes !== 1) throw conflict();
  };
  const open = ["open", "in_progress", "snoozed"].includes(t.status);
  switch (patch.action) {
    case "start":
      if (!open) throw new AppError("conflict", "המשימה כבר סגורה.");
      apply("status = 'in_progress', assignee_id = COALESCE(assignee_id, ?)", ctx.userId);
      break;
    case "snooze": {
      if (!open) throw new AppError("conflict", "המשימה כבר סגורה.");
      if (!patch.snoozed_until || Number.isNaN(Date.parse(patch.snoozed_until)) || patch.snoozed_until <= now) throw invalid({ snoozed_until: "בחרו תאריך ושעה עתידיים." });
      const until = new Date(patch.snoozed_until).toISOString();
      apply("status = 'snoozed', snoozed_until = ?, snooze_reason = ?, due_at = ?", until, patch.snooze_reason?.trim() || null, until);
      break;
    }
    case "dismiss":
      if (!open) throw new AppError("conflict", "המשימה כבר סגורה.");
      if (!patch.dismiss_reason?.trim()) throw invalid({ dismiss_reason: "כתבו למה מחריגים את המשימה." });
      apply("status = 'dismissed', dismiss_reason = ?, completed_at = ?, completed_by = ?", patch.dismiss_reason.trim(), now, ctx.userId);
      break;
    case "assign":
      if (patch.assignee_id && !one("SELECT 1 FROM staff_memberships WHERE studio_id = ? AND user_id = ? AND active = 1", ctx.studio.id, patch.assignee_id)) {
        throw invalid({ assignee_id: "האחראי שנבחר אינו בצוות." });
      }
      apply("assignee_id = ?", patch.assignee_id || null);
      break;
    case "reopen":
      if (open) return t;
      apply("status = 'open', completed_at = NULL, outcome = NULL, dismiss_reason = NULL");
      break;
    case "edit":
      if (patch.due_at && Number.isNaN(Date.parse(patch.due_at))) throw invalid({ due_at: "מועד לא תקין." });
      apply("title = COALESCE(?, title), due_at = COALESCE(?, due_at)", patch.title?.trim() || null, patch.due_at ? new Date(patch.due_at).toISOString() : null);
      break;
    case "complete":
      if (!open) throw new AppError("conflict", "המשימה כבר סגורה.");
      recordOutcome(ctx, {
        contact_id: t.contact_id,
        task_id: t.id,
        task_version: patch.version,
        outcome: patch.outcome,
        note: patch.outcome_note,
        channel: patch.channel,
        follow_up: patch.follow_up,
        renewal_reference: patch.renewal_reference,
        membership_id: patch.membership_id,
      });
      break;
  }
  return getTask(ctx, taskId);
}

const CONTACT_OUTCOMES = new Set<Outcome>(["interested", "needs_time", "asked_details", "wants_trial", "renewed", "not_interested", "stop_contact"]);

/**
 * Records the result of a follow-up and closes the loop: suggestion, draft,
 * task, stage and preferences (FUP-03, AC-05, AC-10).
 */
export function recordOutcome(
  ctx: Ctx,
  input: {
    contact_id: string;
    outcome?: Outcome;
    note?: string;
    channel?: string;
    suggestion_id?: string | null;
    draft_id?: string | null;
    task_id?: string | null;
    task_version?: number;
    follow_up?: { due_at: string; title?: string } | null;
    renewal_reference?: string;
    membership_id?: string;
    lost_reason?: string;
  },
) {
  assertCan(ctx, "contacts.edit");
  const contact = getContact(ctx, input.contact_id);
  const fields: Record<string, string> = {};
  if (!input.outcome || !OUTCOMES.includes(input.outcome)) fields.outcome = "בחרו מה קרה.";
  const channel = ["whatsapp", "call", "in_person", "none", "other"].includes(input.channel ?? "") ? input.channel! : "whatsapp";
  if (input.outcome === "renewed") {
    const hasMembership = input.membership_id
      ? one("SELECT 1 FROM memberships WHERE id = ? AND contact_id = ? AND studio_id = ? AND cancelled_at IS NULL", input.membership_id, contact.id, ctx.studio.id)
      : null;
    if (!hasMembership && !input.renewal_reference?.trim()) {
      fields.renewal_reference = "כדי לסמן 'חידש' צריך מנוי מתועד או אסמכתה (למשל מספר קבלה).";
    }
  }
  if (input.follow_up && (Number.isNaN(Date.parse(input.follow_up.due_at)) || !input.follow_up.due_at)) fields.follow_up = "בחרו מועד למעקב הבא.";
  if (Object.keys(fields).length) throw invalid(fields);
  const outcome = input.outcome!;
  const now = nowIso();

  let draft: { id: string; suggestion_id: string | null; task_id: string | null; status: string } | undefined;
  if (input.draft_id) {
    draft = one("SELECT id, suggestion_id, task_id, status FROM message_drafts WHERE id = ? AND studio_id = ? AND contact_id = ?", input.draft_id, ctx.studio.id, contact.id);
    if (!draft) throw invalid({ draft_id: "הטיוטה לא נמצאה." });
  }
  const suggestionId = input.suggestion_id ?? draft?.suggestion_id ?? null;
  const taskId = input.task_id ?? draft?.task_id ?? null;

  tx(() => {
    run(
      `INSERT INTO interaction_events (id, studio_id, contact_id, task_id, draft_id, suggestion_id, channel, event_type, evidence_type, outcome, note, marketing, occurred_at, actor_id)
       VALUES (?,?,?,?,?,?,?, 'outcome_recorded', 'staff_entry', ?,?,?,?,?)`,
      id("evt"),
      ctx.studio.id,
      contact.id,
      taskId,
      draft?.id ?? null,
      suggestionId,
      channel,
      outcome,
      input.note?.trim().slice(0, 2000) || null,
      // A call that reached the person counts toward contact frequency; WhatsApp is counted at 'marked_sent'.
      channel === "call" && outcome !== "no_answer" && !taskId ? 1 : 0,
      now,
      ctx.userId,
    );
    if (draft) run("UPDATE message_drafts SET status = 'outcome_recorded', version = version + 1, updated_at = ? WHERE id = ? AND status <> 'invalidated'", now, draft.id);
    if (suggestionId) {
      run("UPDATE suggestions SET status = 'completed', status_reason = ?, updated_at = ? WHERE id = ? AND studio_id = ? AND status IN ('active','snoozed')", outcome, now, suggestionId, ctx.studio.id);
    }
    if (taskId) {
      const res = run(
        `UPDATE tasks SET status = 'completed', outcome = ?, outcome_note = ?, outcome_channel = ?, completed_at = ?, completed_by = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND studio_id = ? AND status IN ('open','in_progress','snoozed') ${input.task_version !== undefined ? "AND version = ?" : ""}`,
        outcome,
        input.note?.trim() || null,
        channel,
        now,
        ctx.userId,
        now,
        taskId,
        ctx.studio.id,
        ...(input.task_version !== undefined ? [input.task_version] : []),
      );
      if (input.task_version !== undefined && res.changes !== 1) throw conflict();
    }
    // Stage: a real contact moves a new lead to "contacted" (opening WhatsApp alone is not enough).
    let nextStage: string | null = null;
    let stageReason: string | null = null;
    if (contact.pipeline_stage === "new_lead" && CONTACT_OUTCOMES.has(outcome)) nextStage = "contacted";
    if (outcome === "wants_trial" && ["new_lead", "contacted", "decision_pending"].includes(contact.pipeline_stage)) nextStage = "decision_pending";
    if ((outcome === "needs_time" || outcome === "asked_details" || outcome === "interested") && contact.pipeline_stage === "trial_attended") nextStage = "decision_pending";
    if (outcome === "not_interested" && input.lost_reason?.trim()) {
      nextStage = "lost";
      stageReason = input.lost_reason.trim();
    }
    if (outcome === "renewed" && contact.pipeline_stage !== "converted" && !["lost"].includes(contact.pipeline_stage)) {
      nextStage = "converted";
      stageReason = input.renewal_reference?.trim() || "מנוי מתועד";
    }
    if (nextStage && nextStage !== contact.pipeline_stage) {
      run("UPDATE contacts SET pipeline_stage = ?, stage_reason = ?, version = version + 1, updated_at = ? WHERE id = ?", nextStage, stageReason, now, contact.id);
      run(
        "INSERT INTO stage_changes (id, studio_id, contact_id, from_stage, to_stage, reason, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
        id("stg"),
        ctx.studio.id,
        contact.id,
        contact.pipeline_stage,
        nextStage,
        stageReason,
        ctx.userId,
        now,
      );
    }
    if (outcome === "renewed") {
      run(
        "INSERT INTO interaction_events (id, studio_id, contact_id, channel, event_type, evidence_type, note, occurred_at, actor_id) VALUES (?,?,?,?,?,?,?,?,?)",
        id("evt"),
        ctx.studio.id,
        contact.id,
        "system",
        "renewal",
        input.membership_id ? "membership_record" : "reference",
        input.renewal_reference?.trim() || input.membership_id || null,
        now,
        ctx.userId,
      );
      run(
        "UPDATE suggestions SET status = 'superseded', status_reason = 'renewed', updated_at = ? WHERE contact_id = ? AND studio_id = ? AND rule_id IN ('R03','R04','R07') AND status IN ('active','snoozed')",
        now,
        contact.id,
        ctx.studio.id,
      );
    }
    // Stop request updates the preference immediately (AC-06).
    if (outcome === "stop_contact") {
      setPreferenceRaw(ctx.studio.id, contact.id, false, "ביקש להפסיק קשר", "outcome", ctx.userId, null);
      invalidateDrafts(ctx.studio.id, contact.id, "contact_blocked");
      run(
        "UPDATE suggestions SET status = 'dismissed', status_reason = 'stop_contact', updated_at = ? WHERE contact_id = ? AND studio_id = ? AND status IN ('active','snoozed')",
        now,
        contact.id,
        ctx.studio.id,
      );
      audit({ studioId: ctx.studio.id, actorId: ctx.userId, action: "preference.blocked", entity: "contact", entityId: contact.id, reason: "stop_contact outcome" });
    }
    if (input.follow_up && outcome !== "stop_contact") {
      run(
        `INSERT INTO tasks (id, studio_id, contact_id, assignee_id, reason_code, title, status, due_at, created_by, created_at, updated_at)
         VALUES (?,?,?,?, 'R06', ?, 'open', ?,?,?,?)`,
        id("tsk"),
        ctx.studio.id,
        contact.id,
        contact.owner_id ?? ctx.userId,
        input.follow_up.title?.trim().slice(0, 200) || null,
        new Date(input.follow_up.due_at).toISOString(),
        ctx.userId,
        now,
        now,
      );
    }
  });
}
