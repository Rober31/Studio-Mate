// Message drafts and WhatsApp Click-to-Chat handoff (spec §15–§16, WA-01/02).

import { all, one, run, tx } from "../db";
import { AppError, conflict, invalid, notFound } from "../errors";
import { assertCan, type Ctx } from "../permissions";
import { hashObject, id, nowIso, parseJson } from "../util";
import { waNumber } from "../phone";
import { getContact } from "./contacts";
import { candidatesFor, contactGuards, firstName, getSuggestion, type Facts } from "./followups";
import { membershipsForContact } from "./memberships";
import { aiDraft, templateDraft, TEMPLATE_VERSION, type Lang, type Tone } from "./ai";
import { localDate } from "../time";
import type { RuleKey } from "../studio";

export type DraftRow = {
  id: string;
  contact_id: string;
  suggestion_id: string | null;
  task_id: string | null;
  reason_code: string;
  generated_text: string;
  text: string;
  language: Lang;
  tone: string | null;
  length: string | null;
  facts: string;
  facts_hash: string;
  warnings: string;
  generator: "ai" | "template";
  model_id: string | null;
  status: "ready" | "edited" | "wa_opened" | "marked_sent" | "outcome_recorded" | "invalidated";
  invalid_reason: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type DraftView = Omit<DraftRow, "facts" | "warnings"> & { facts: Facts; warnings: string[] };

function viewDraft(d: DraftRow): DraftView {
  return { ...d, facts: parseJson<Facts>(d.facts, { rule: "GENERAL", first_name: "", language: "he" }), warnings: parseJson<string[]>(d.warnings, []) };
}

function getDraftRow(ctx: Ctx, draftId: string): DraftRow {
  const d = one<DraftRow>("SELECT * FROM message_drafts WHERE id = ? AND studio_id = ?", draftId, ctx.studio.id);
  if (!d) throw notFound("הטיוטה");
  getContact(ctx, d.contact_id); // scope check
  return d;
}

export function getDraft(ctx: Ctx, draftId: string): DraftView {
  return viewDraft(getDraftRow(ctx, draftId));
}

/** Facts for task / general follow-ups (no rule): name, language and membership summary. */
function basicFacts(ctx: Ctx, contactId: string, rule: "R06" | "GENERAL"): Facts {
  const c = getContact(ctx, contactId);
  const tz = ctx.studio.timezone;
  const active = membershipsForContact(ctx.studio.id, contactId).find((m) => m.status === "active");
  const f: Facts = {
    rule: rule === "R06" ? "R06" : "GENERAL",
    first_name: firstName(c.display_name),
    language: c.preferred_language || ctx.studio.settings.messageLanguage,
  };
  if (c.interest) f.interest = c.interest;
  if (active) {
    f.plan_name = active.plan_name;
    if (active.ends_at) f.end_date = localDate(new Date(Date.parse(active.ends_at) - 1), tz);
    if (active.balance !== null) f.balance = active.balance;
  }
  return f;
}

type Source = { suggestionId?: string | null; taskId?: string | null; contactId: string };

/** Recomputes the current facts for a draft source; null when the reason no longer applies. */
function currentFacts(ctx: Ctx, src: Source): { facts: Facts; reasonCode: string } | null {
  if (src.suggestionId) {
    const s = getSuggestion(ctx, src.suggestionId);
    if (s.status !== "active" && s.status !== "snoozed") return null;
    const c = one<{ id: string; display_name: string; preferred_language: string | null; pipeline_stage: string; interest: string | null; created_at: string }>(
      "SELECT id, display_name, preferred_language, pipeline_stage, interest, created_at FROM contacts WHERE id = ?",
      s.contact_id,
    )!;
    const cand = candidatesFor(ctx.studio, c).find((x) => x.eventKey === s.event_key);
    if (!cand) return null;
    return { facts: cand.facts, reasonCode: s.rule_id };
  }
  if (src.taskId) {
    const t = one<{ status: string; reason_code: string }>("SELECT status, reason_code FROM tasks WHERE id = ? AND studio_id = ?", src.taskId, ctx.studio.id);
    if (!t || !["open", "in_progress", "snoozed"].includes(t.status)) return null;
    const rule = (["R01", "R02", "R03", "R04", "R05", "R07"].includes(t.reason_code) ? t.reason_code : "R06") as RuleKey;
    const f = basicFacts(ctx, src.contactId, "R06");
    return { facts: { ...f, rule }, reasonCode: rule };
  }
  return { facts: basicFacts(ctx, src.contactId, "GENERAL"), reasonCode: "GENERAL" };
}

function monthlyAiUsage(studioId: string): number {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return one<{ n: number }>("SELECT COUNT(*) AS n FROM usage_events WHERE studio_id = ? AND kind = 'ai_draft' AND created_at >= ?", studioId, start.toISOString())!.n;
}

export async function prepareDraft(
  ctx: Ctx,
  input: { contact_id: string; suggestion_id?: string | null; task_id?: string | null; language?: Lang; tone?: Tone; length?: "short" | "normal"; override_reason?: string | null },
): Promise<DraftView> {
  assertCan(ctx, "followup.use");
  const contact = getContact(ctx, input.contact_id);
  if (input.suggestion_id) {
    const s = getSuggestion(ctx, input.suggestion_id);
    if (s.contact_id !== contact.id) throw invalid({ suggestion_id: "ההצעה לא שייכת ללקוח." });
  }
  if (input.task_id) {
    const t = one<{ contact_id: string }>("SELECT contact_id FROM tasks WHERE id = ? AND studio_id = ?", input.task_id, ctx.studio.id);
    if (!t || t.contact_id !== contact.id) throw invalid({ task_id: "המשימה לא שייכת ללקוח." });
  }
  const guards = contactGuards(ctx.studio, contact.id);
  if (guards.blocked) throw new AppError("blocked", "הלקוח ביקש שלא ניצור איתו קשר. אי אפשר להכין הודעה.");
  const isMarketing = !input.task_id;
  if (isMarketing && (guards.cooldownUntil || guards.overLimit) && !input.override_reason?.trim()) {
    throw new AppError("blocked", "פנו ללקוח לאחרונה. כדי להכין הודעה בכל זאת, כתבו סיבה.", { details: { needsOverride: true, cooldownUntil: guards.cooldownUntil } });
  }

  const current = currentFacts(ctx, { suggestionId: input.suggestion_id, taskId: input.task_id, contactId: contact.id });
  if (!current) {
    if (input.suggestion_id) run("UPDATE suggestions SET status = 'superseded', status_reason = 'condition_cleared', updated_at = ? WHERE id = ?", nowIso(), input.suggestion_id);
    throw new AppError("conflict", "הסיבה למעקב כבר לא רלוונטית (למשל המנוי חודש). רעננו את הרשימה.");
  }
  const allowedLang: Lang[] = ["he", "ar", "en"];
  const lang = (input.language && allowedLang.includes(input.language) ? input.language : (contact.preferred_language as Lang) || ctx.studio.settings.messageLanguage) as Lang;
  const facts = { ...current.facts, language: lang };
  const settings = ctx.studio.settings;
  const hasAi = ctx.studio.modules.includes("ai");
  const overQuota = monthlyAiUsage(ctx.studio.id) >= settings.aiMonthlyQuota;

  const result = !hasAi
    ? templateDraft(facts, current.reasonCode, lang, settings.signature)
    : overQuota
      ? (() => {
          const t = templateDraft(facts, current.reasonCode, lang, settings.signature);
          t.warnings.push("ai_quota_reached");
          return t;
        })()
      : await aiDraft({
          facts,
          reasonCode: current.reasonCode,
          lang,
          tone: input.tone ?? "warm",
          length: input.length ?? "normal",
          studioName: ctx.studio.name,
          studioStyle: settings.studioStyle,
          addressingForm: contact.gender_form === "f" || contact.gender_form === "m" ? contact.gender_form : "neutral",
          signature: settings.signature,
        });

  const warnings = [...result.warnings];
  if (!facts.plan_name && ["R03", "R04", "R05", "R07"].includes(current.reasonCode)) warnings.push("missing_plan");
  if (guards.phoneInvalid) warnings.push("phone_invalid");
  if (input.override_reason?.trim()) warnings.push("cooldown_override");

  const now = nowIso();
  const draftId = id("drf");
  tx(() => {
    run(
      `INSERT INTO message_drafts (id, studio_id, contact_id, suggestion_id, task_id, reason_code, generated_text, text, language, tone, length,
         facts, facts_hash, warnings, generator, template_version, model_id, status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ready', ?,?,?)`,
      draftId,
      ctx.studio.id,
      contact.id,
      input.suggestion_id ?? null,
      input.task_id ?? null,
      current.reasonCode,
      result.text,
      result.text,
      lang,
      input.tone ?? "warm",
      input.length ?? "normal",
      JSON.stringify(facts),
      hashObject(current.facts),
      JSON.stringify(warnings),
      result.generator,
      TEMPLATE_VERSION,
      result.modelId,
      ctx.userId,
      now,
      now,
    );
    if (result.generator === "ai" || (hasAi && !overQuota)) {
      run(
        "INSERT INTO usage_events (id, studio_id, kind, model, units, duration_ms, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
        id("use"),
        ctx.studio.id,
        result.generator === "ai" ? "ai_draft" : "ai_fallback",
        result.modelId,
        result.usageUnits,
        result.durationMs,
        ctx.userId,
        now,
      );
    }
    if (input.override_reason?.trim()) {
      run(
        "INSERT INTO audit_events (id, studio_id, actor_id, action, entity, entity_id, reason, created_at) VALUES (?,?,?,?,?,?,?,?)",
        id("aud"),
        ctx.studio.id,
        ctx.userId,
        "followup.cooldown_override",
        "contact",
        contact.id,
        input.override_reason.trim(),
        now,
      );
    }
  });
  return getDraft(ctx, draftId);
}

export function editDraft(ctx: Ctx, draftId: string, text: string, version: number): DraftView {
  assertCan(ctx, "followup.use");
  const d = getDraftRow(ctx, draftId);
  if (d.status === "invalidated") throw new AppError("conflict", "הטיוטה כבר לא בתוקף. הכינו הודעה חדשה.");
  if (!["ready", "edited"].includes(d.status)) throw new AppError("conflict", "ההודעה כבר נפתחה בוואטסאפ.");
  const clean = (text ?? "").trim();
  if (!clean) throw invalid({ text: "ההודעה ריקה." });
  if (clean.length > 1000) throw invalid({ text: "ההודעה ארוכה מדי." });
  const res = run(
    "UPDATE message_drafts SET text = ?, status = CASE WHEN ? = generated_text THEN status ELSE 'edited' END, edited_by = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
    clean,
    clean,
    ctx.userId,
    nowIso(),
    draftId,
    version,
  );
  if (res.changes !== 1) throw conflict();
  return getDraft(ctx, draftId);
}

function invalidate(draftId: string, reason: string) {
  run("UPDATE message_drafts SET status = 'invalidated', invalid_reason = ?, updated_at = ? WHERE id = ?", reason, nowIso(), draftId);
}

/** Re-checks facts, permission and preferences, then returns the wa.me link (WA-01). */
export function handoff(ctx: Ctx, draftId: string, text?: string): { url: string; phone: string; text: string; draft: DraftView } {
  assertCan(ctx, "followup.use");
  const d = getDraftRow(ctx, draftId);
  if (d.status === "invalidated") throw new AppError("conflict", "הטיוטה כבר לא בתוקף. הכינו הודעה חדשה.", { details: { invalidReason: d.invalid_reason } });
  const contact = getContact(ctx, d.contact_id);
  const guards = contactGuards(ctx.studio, contact.id);
  if (guards.blocked) {
    invalidate(d.id, "contact_blocked");
    throw new AppError("blocked", "הלקוח ביקש שלא ניצור איתו קשר. ההודעה בוטלה.");
  }
  if (guards.phoneInvalid || !contact.phone_e164) {
    throw new AppError("blocked", "מספר הטלפון חסר או לא תקין. תקנו אותו בתיק הלקוח ואז נסו שוב.", { details: { fixPhone: true } });
  }
  const current = currentFacts(ctx, { suggestionId: d.suggestion_id, taskId: d.task_id, contactId: d.contact_id });
  if (!current) {
    invalidate(d.id, "reason_cleared");
    throw new AppError("conflict", "הסיבה למעקב כבר לא רלוונטית, לכן ההודעה בוטלה.", { details: { invalidReason: "reason_cleared" } });
  }
  if (hashObject(current.facts) !== d.facts_hash) {
    invalidate(d.id, "facts_changed");
    throw new AppError("conflict", "הנתונים של הלקוח השתנו מאז שההודעה הוכנה. צריך להכין אותה מחדש.", { details: { invalidReason: "facts_changed" } });
  }
  let finalText = d.text;
  if (text !== undefined && text.trim() && text.trim() !== d.text) {
    if (!["ready", "edited"].includes(d.status)) throw new AppError("conflict", "ההודעה כבר נפתחה.");
    finalText = text.trim().slice(0, 1000);
  }
  const now = nowIso();
  tx(() => {
    run(
      "UPDATE message_drafts SET text = ?, status = CASE WHEN status IN ('ready','edited') THEN 'wa_opened' ELSE status END, edited_by = CASE WHEN ? <> text THEN ? ELSE edited_by END, version = version + 1, updated_at = ? WHERE id = ?",
      finalText,
      finalText,
      ctx.userId,
      now,
      d.id,
    );
    run(
      "INSERT INTO interaction_events (id, studio_id, contact_id, task_id, draft_id, suggestion_id, channel, event_type, occurred_at, actor_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
      id("evt"),
      ctx.studio.id,
      contact.id,
      d.task_id,
      d.id,
      d.suggestion_id,
      "whatsapp",
      "wa_opened",
      now,
      ctx.userId,
    );
  });
  const url = `https://wa.me/${waNumber(contact.phone_e164)}?text=${encodeURIComponent(finalText)}`;
  return { url, phone: contact.phone_e164, text: finalText, draft: getDraft(ctx, d.id) };
}

/** Staff confirms they actually sent the message (manual_confirmation evidence). */
export function markSent(ctx: Ctx, draftId: string): DraftView {
  assertCan(ctx, "followup.use");
  const d = getDraftRow(ctx, draftId);
  if (d.status === "invalidated") throw new AppError("conflict", "הטיוטה כבר לא בתוקף.");
  if (d.status === "marked_sent" || d.status === "outcome_recorded") return getDraft(ctx, draftId);
  if (d.status !== "wa_opened") throw new AppError("conflict", "קודם פותחים את ההודעה בוואטסאפ.");
  const now = nowIso();
  tx(() => {
    run("UPDATE message_drafts SET status = 'marked_sent', version = version + 1, updated_at = ? WHERE id = ?", now, d.id);
    run(
      "INSERT INTO interaction_events (id, studio_id, contact_id, task_id, draft_id, suggestion_id, channel, event_type, evidence_type, marketing, occurred_at, actor_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      id("evt"),
      ctx.studio.id,
      d.contact_id,
      d.task_id,
      d.id,
      d.suggestion_id,
      "whatsapp",
      "marked_sent",
      "manual_confirmation",
      d.task_id ? 0 : 1,
      now,
      ctx.userId,
    );
  });
  return getDraft(ctx, draftId);
}

export function draftsForContact(ctx: Ctx, contactId: string) {
  getContact(ctx, contactId);
  return all<DraftRow>("SELECT * FROM message_drafts WHERE contact_id = ? AND studio_id = ? ORDER BY created_at DESC LIMIT 20", contactId, ctx.studio.id).map(viewDraft);
}
