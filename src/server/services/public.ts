// Public QR registration (S08) and member identity for attendance (S09) — spec §18–§19.

import { all, one, run, tx } from "../db";
import { AppError, invalid, notFound } from "../errors";
import { assertCan, type Ctx } from "../permissions";
import type { Studio } from "../studio";
import { addDays, addHours, id, nowIso, sha256, token } from "../util";
import { normalizePhone } from "../phone";
import { getContact, setPreferenceRaw } from "./contacts";
import { audit } from "../audit";
import { markEvaluationStale } from "./followups";

export type RegistrationInput = {
  request_id?: string;
  name?: string;
  phone?: string;
  country?: string;
  language?: string;
  interest?: string;
  note?: string;
  contact_allowed?: boolean;
  website?: string; // honeypot
};

/**
 * Accepts a registration request. Always answers with the same generic receipt,
 * never revealing whether the phone already belongs to a customer (AC-Q01).
 */
export async function submitRegistration(studio: Studio, input: RegistrationInput): Promise<{ status: "received" }> {
  if (!studio.modules.includes("qr")) throw notFound("הדף");
  const fields: Record<string, string> = {};
  const name = (input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) fields.name = "איך קוראים לך?";
  else if (name.length > 80) fields.name = "השם ארוך מדי.";
  const phone = normalizePhone((input.phone ?? "").slice(0, 30), (input.country ?? studio.default_country).slice(0, 2).toUpperCase());
  if (!phone.valid) fields.phone = "מספר הטלפון לא נראה תקין.";
  const requestId = (input.request_id ?? "").slice(0, 64);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) fields.request_id = "רעננו את הדף ונסו שוב.";
  if (Object.keys(fields).length) throw invalid(fields);
  if (input.website) return { status: "received" }; // bot

  const existingRequest = await one("SELECT 1 FROM registrations WHERE studio_id = ? AND request_id = ?", studio.id, requestId);
  if (existingRequest) return { status: "received" };
  // Duplicate submission window: same phone within 10 minutes is treated as one request.
  const recent = await one(
    "SELECT 1 FROM registrations WHERE studio_id = ? AND phone_e164 = ? AND created_at > ?",
    studio.id,
    phone.e164,
    new Date(Date.now() - 10 * 60_000).toISOString(),
  );
  if (recent) return { status: "received" };

  const lang = ["he", "ar", "en"].includes(input.language ?? "") ? input.language! : null;
  const interest = input.interest?.trim().slice(0, 100) || null;
  const note = input.note?.trim().slice(0, 500) || null;
  const allowed = input.contact_allowed === true;
  const now = nowIso();

  await tx(async () => {
    const match = await one<{ id: string; owner_id: string | null }>(
      "SELECT id, owner_id FROM contacts WHERE studio_id = ? AND phone_e164 = ? AND merged_into IS NULL ORDER BY created_at LIMIT 1",
      studio.id,
      phone.e164,
    );
    let contactId: string;
    if (match) {
      // Existing number: record the request and a review task; never overwrite verified data.
      contactId = match.id;
      await run(
        `INSERT INTO tasks (id, studio_id, contact_id, assignee_id, reason_code, title, status, due_at, created_at, updated_at)
         VALUES (?,?,?,?, 'REG', ?, 'open', ?,?,?)`,
        id("tsk"),
        studio.id,
        contactId,
        match.owner_id,
        `בקשת הרשמה חדשה (QR) בשם "${name}"`,
        now,
        now,
        now,
      );
    } else {
      contactId = id("con");
      await run(
        `INSERT INTO contacts (id, studio_id, display_name, phone_e164, phone_raw, phone_valid, preferred_language, pipeline_stage, source, interest, tags, created_at, updated_at)
         VALUES (?,?,?,?,?,1,?, 'new_lead', 'qr', ?, '[]', ?,?)`,
        contactId,
        studio.id,
        name,
        phone.e164,
        phone.raw,
        lang,
        interest,
        now,
        now,
      );
      await run(
        "INSERT INTO stage_changes (id, studio_id, contact_id, from_stage, to_stage, reason, created_at) VALUES (?,?,?,?,?,?,?)",
        id("stg"),
        studio.id,
        contactId,
        null,
        "new_lead",
        "הרשמה ב-QR",
        now,
      );
      await setPreferenceRaw(studio.id, contactId, allowed, allowed ? null : "לא אישר/ה קבלת הודעות בהרשמה", "qr_registration", null, studio.settings.noticeVersion);
      if (note) {
        await run("INSERT INTO notes (id, studio_id, contact_id, body, is_private, created_at) VALUES (?,?,?,?,0,?)", id("not"), studio.id, contactId, `מטופס ההרשמה: ${note}`, now);
      }
    }
    await run(
      `INSERT INTO registrations (id, studio_id, request_id, name, phone_raw, phone_e164, language, interest, note, contact_allowed, notice_version, contact_id, matched_existing, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id("reg"),
      studio.id,
      requestId,
      name,
      phone.raw,
      phone.e164,
      lang,
      interest,
      note,
      allowed ? 1 : 0,
      studio.settings.noticeVersion,
      contactId,
      match ? 1 : 0,
      now,
    );
    await run(
      "INSERT INTO interaction_events (id, studio_id, contact_id, channel, event_type, evidence_type, note, occurred_at) VALUES (?,?,?,?,?,?,?,?)",
      id("evt"),
      studio.id,
      contactId,
      "qr",
      "registration",
      "public_form",
      interest,
      now,
    );
  });
  await markEvaluationStale(studio.id);
  return { status: "received" };
}

export async function listRegistrations(ctx: Ctx, status: "new" | "all") {
  assertCan(ctx, "registrations.review");
  return await all<{
    id: string;
    name: string;
    phone_e164: string | null;
    interest: string | null;
    note: string | null;
    contact_allowed: number;
    matched_existing: number;
    contact_id: string | null;
    contact_name: string | null;
    status: string;
    created_at: string;
  }>(
    `SELECT r.id, r.name, r.phone_e164, r.interest, r.note, r.contact_allowed, r.matched_existing, r.contact_id, c.display_name AS contact_name, r.status, r.created_at
       FROM registrations r LEFT JOIN contacts c ON c.id = r.contact_id
      WHERE r.studio_id = ? ${status === "new" ? "AND r.status = 'new'" : ""} ORDER BY r.created_at DESC LIMIT 200`,
    ctx.studio.id,
  );
}

export async function newRegistrationsCount(studioId: string): Promise<number> {
  return (await one<{ n: number }>("SELECT COUNT(*) AS n FROM registrations WHERE studio_id = ? AND status = 'new'", studioId))!.n;
}

export async function reviewRegistration(ctx: Ctx, registrationId: string, decision: "reviewed" | "rejected" | null, ownerId?: string | null) {
  assertCan(ctx, "registrations.review");
  const r = await one<{ id: string; contact_id: string | null; status: string }>("SELECT id, contact_id, status FROM registrations WHERE id = ? AND studio_id = ?", registrationId, ctx.studio.id);
  if (!r) throw notFound("הבקשה");
  await tx(async () => {
    if (decision) await run("UPDATE registrations SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?", decision, ctx.userId, nowIso(), registrationId);
    if (ownerId !== undefined && r.contact_id) {
      if (ownerId && !await one("SELECT 1 FROM staff_memberships WHERE studio_id = ? AND user_id = ? AND active = 1", ctx.studio.id, ownerId)) {
        throw invalid({ owner_id: "האחראי לא בצוות." });
      }
      await run("UPDATE contacts SET owner_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND studio_id = ?", ownerId || null, nowIso(), r.contact_id, ctx.studio.id);
    }
  });
}

// ---------------------------------------------------------------------------
// Member activation (one-time link) and member sessions (attendance only).

export const MEMBER_COOKIE = "sm_member";
const ACTIVATION_HOURS = 24;
const MEMBER_SESSION_DAYS = 180;

export async function createActivation(ctx: Ctx, contactId: string) {
  assertCan(ctx, "attendance.record");
  if (ctx.role === "instructor") {
    // Instructors can link a device in person but do not see CRM data.
    const exists = await one("SELECT 1 FROM contacts WHERE id = ? AND studio_id = ? AND merged_into IS NULL", contactId, ctx.studio.id);
    if (!exists) throw notFound("הלקוח");
  } else {
    await getContact(ctx, contactId);
  }
  const raw = token(24);
  const now = nowIso();
  await tx(async () => {
    await run("UPDATE member_activations SET revoked_at = ? WHERE contact_id = ? AND studio_id = ? AND used_at IS NULL AND revoked_at IS NULL", now, contactId, ctx.studio.id);
    await run(
      "INSERT INTO member_activations (id, studio_id, contact_id, token_hash, expires_at, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
      id("act"),
      ctx.studio.id,
      contactId,
      sha256(raw),
      addHours(now, ACTIVATION_HOURS),
      ctx.userId,
      now,
    );
    await audit({ studioId: ctx.studio.id, actorId: ctx.userId, action: "member.activation_created", entity: "contact", entityId: contactId });
  });
  return { token: raw, expires_at: addHours(now, ACTIVATION_HOURS) };
}

export async function activationInfo(rawToken: string) {
  const a = await one<{ studio_id: string; contact_id: string; expires_at: string; used_at: string | null; revoked_at: string | null }>(
    "SELECT studio_id, contact_id, expires_at, used_at, revoked_at FROM member_activations WHERE token_hash = ?",
    sha256(rawToken),
  );
  if (!a || a.revoked_at || a.used_at || a.expires_at < nowIso()) return null;
  const studio = await one<{ name: string }>("SELECT name FROM studios WHERE id = ?", a.studio_id);
  const contact = await one<{ display_name: string }>("SELECT display_name FROM contacts WHERE id = ?", a.contact_id);
  return { studioName: studio?.name ?? "", firstName: (contact?.display_name ?? "").split(/\s+/)[0] };
}

/** Redeems a one-time activation link and returns a raw member-session token. */
export async function redeemActivation(rawToken: string): Promise<{ sessionToken: string; expires: string; studioId: string }> {
  if (!rawToken || rawToken.length > 100) throw new AppError("validation", "הקישור אינו תקין.");
  return await tx(async () => {
    const a = await one<{ id: string; studio_id: string; contact_id: string; expires_at: string; used_at: string | null; revoked_at: string | null }>(
      "SELECT id, studio_id, contact_id, expires_at, used_at, revoked_at FROM member_activations WHERE token_hash = ?",
      sha256(rawToken),
    );
    if (!a || a.revoked_at || a.used_at || a.expires_at < nowIso()) {
      throw new AppError("blocked", "הקישור כבר שומש או שפג תוקפו. בקשו קישור חדש בקבלה.");
    }
    const now = nowIso();
    await run("UPDATE member_activations SET used_at = ? WHERE id = ?", now, a.id);
    const raw = token(32);
    const expires = addDays(now, MEMBER_SESSION_DAYS);
    await run(
      "INSERT INTO member_sessions (id, studio_id, contact_id, token_hash, expires_at, created_at) VALUES (?,?,?,?,?,?)",
      id("msn"),
      a.studio_id,
      a.contact_id,
      sha256(raw),
      expires,
      now,
    );
    return { sessionToken: raw, expires, studioId: a.studio_id };
  });
}

/** Resolves the member session cookie for a given studio. Member sessions grant attendance only. */
export async function memberFromToken(rawToken: string | undefined, studioId: string) {
  if (!rawToken) return null;
  const s = await one<{ id: string; contact_id: string; display_name: string }>(
    `SELECT ms.id, ms.contact_id, c.display_name FROM member_sessions ms JOIN contacts c ON c.id = ms.contact_id
      WHERE ms.token_hash = ? AND ms.studio_id = ? AND ms.revoked_at IS NULL AND ms.expires_at > ? AND c.merged_into IS NULL`,
    sha256(rawToken),
    studioId,
    nowIso(),
  );
  if (!s) return null;
  await run("UPDATE member_sessions SET last_used_at = ? WHERE id = ?", nowIso(), s.id);
  return { contactId: s.contact_id, firstName: s.display_name.split(/\s+/)[0] };
}

export async function memberDevices(ctx: Ctx, contactId: string) {
  await getContact(ctx, contactId);
  return await all<{ id: string; created_at: string; last_used_at: string | null; expires_at: string }>(
    "SELECT id, created_at, last_used_at, expires_at FROM member_sessions WHERE contact_id = ? AND studio_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC",
    contactId,
    ctx.studio.id,
    nowIso(),
  );
}

export async function revokeMemberDevices(ctx: Ctx, contactId: string) {
  await getContact(ctx, contactId);
  await run("UPDATE member_sessions SET revoked_at = ? WHERE contact_id = ? AND studio_id = ? AND revoked_at IS NULL", nowIso(), contactId, ctx.studio.id);
  await audit({ studioId: ctx.studio.id, actorId: ctx.userId, action: "member.sessions_revoked", entity: "contact", entityId: contactId });
}
