import { all, one, run, tx } from "../db";
import { AppError, conflict, invalid, notFound } from "../errors";
import { normalizePhone } from "../phone";
import { assertCan, contactScopeSql, type Ctx } from "../permissions";
import { audit } from "../audit";
import { id, nowIso, parseJson } from "../util";

export const STAGES = [
  "new_lead",
  "contacted",
  "trial_scheduled",
  "trial_attended",
  "decision_pending",
  "converted",
  "lost",
] as const;
export type Stage = (typeof STAGES)[number];

export type ContactRow = {
  id: string;
  studio_id: string;
  display_name: string;
  phone_e164: string | null;
  phone_raw: string | null;
  phone_valid: number;
  preferred_language: string | null;
  gender_form: string | null;
  pipeline_stage: Stage;
  stage_reason: string | null;
  owner_id: string | null;
  source: string;
  external_id: string | null;
  interest: string | null;
  tags: string;
  needs_review: number;
  review_reason: string | null;
  merged_into: string | null;
  archived: number;
  version: number;
  created_at: string;
  updated_at: string;
};

export type Contact = Omit<ContactRow, "tags"> & {
  tags: string[];
  owner_name: string | null;
  contact_allowed: boolean;
  contact_block_reason: string | null;
};

function hydrate(row: ContactRow & { owner_name?: string | null; allowed?: number | null; block_reason?: string | null }): Contact {
  return {
    ...row,
    tags: parseJson<string[]>(row.tags, []),
    owner_name: row.owner_name ?? null,
    contact_allowed: row.allowed === null || row.allowed === undefined ? true : row.allowed === 1,
    contact_block_reason: row.block_reason ?? null,
  };
}

const SELECT = `SELECT c.*, u.name AS owner_name, p.allowed AS allowed, p.reason AS block_reason
  FROM contacts c
  LEFT JOIN users u ON u.id = c.owner_id
  LEFT JOIN contact_preferences p ON p.contact_id = c.id AND p.channel = 'whatsapp'`;

/** Loads a contact the user may see; 404 otherwise (AC-12: no content leak). */
export async function getContact(ctx: Ctx, contactId: string): Promise<Contact> {
  assertCan(ctx, "contacts.view");
  const scope = contactScopeSql(ctx);
  const row = await one<ContactRow>(
    `${SELECT} WHERE c.id = ? AND c.studio_id = ? AND ${scope.sql}`,
    contactId,
    ctx.studio.id,
    ...scope.params,
  );
  if (!row) throw notFound("הלקוח");
  return hydrate(row);
}

/** Minimal lookup for attendance screens (instructor role). */
export async function getContactBasic(studioId: string, contactId: string) {
  return await one<{ id: string; display_name: string }>(
    "SELECT id, display_name FROM contacts WHERE id = ? AND studio_id = ? AND merged_into IS NULL",
    contactId,
    studioId,
  );
}

export type ContactFilters = {
  q?: string;
  stage?: string;
  owner?: string;
  source?: string;
  tag?: string;
  membership?: "active" | "none" | "ending";
  review?: boolean;
  archived?: boolean;
  page?: number;
  pageSize?: number;
};

export async function listContacts(ctx: Ctx, f: ContactFilters) {
  assertCan(ctx, "contacts.view");
  const scope = contactScopeSql(ctx);
  const where: string[] = ["c.studio_id = ?", "c.merged_into IS NULL", scope.sql];
  const params: unknown[] = [ctx.studio.id, ...scope.params];
  where.push(f.archived ? "c.archived = 1" : "c.archived = 0");
  if (f.q?.trim()) {
    const q = f.q.trim();
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 3) {
      const local = digits.replace(/^0/, "");
      where.push("(c.display_name LIKE ? OR c.phone_e164 LIKE ? OR c.phone_raw LIKE ?)");
      params.push(`%${q}%`, `%${local}%`, `%${digits}%`);
    } else {
      where.push("c.display_name LIKE ?");
      params.push(`%${q}%`);
    }
  }
  if (f.stage) {
    where.push("c.pipeline_stage = ?");
    params.push(f.stage);
  }
  if (f.owner === "none") where.push("c.owner_id IS NULL");
  else if (f.owner) {
    where.push("c.owner_id = ?");
    params.push(f.owner);
  }
  if (f.source) {
    where.push("c.source = ?");
    params.push(f.source);
  }
  if (f.tag) {
    where.push("EXISTS (SELECT 1 FROM json_each(c.tags) WHERE json_each.value = ?)");
    params.push(f.tag);
  }
  if (f.review) where.push("(c.needs_review = 1 OR c.phone_valid = 0)");
  const now = nowIso();
  if (f.membership === "active") {
    where.push(
      "EXISTS (SELECT 1 FROM memberships m WHERE m.contact_id = c.id AND m.cancelled_at IS NULL AND m.starts_at <= ? AND (m.ends_at IS NULL OR m.ends_at > ?))",
    );
    params.push(now, now);
  } else if (f.membership === "none") {
    where.push(
      "NOT EXISTS (SELECT 1 FROM memberships m WHERE m.contact_id = c.id AND m.cancelled_at IS NULL AND (m.ends_at IS NULL OR m.ends_at > ?))",
    );
    params.push(now);
  }
  const pageSize = Math.min(Math.max(f.pageSize ?? 30, 1), 100);
  const page = Math.max(f.page ?? 1, 1);
  const total = (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM contacts c WHERE ${where.join(" AND ")}`, ...params))!.n;
  const rows = await all<ContactRow>(
    `${SELECT} WHERE ${where.join(" AND ")} ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    (page - 1) * pageSize,
  );
  return { items: rows.map(hydrate), total, page, pageSize };
}

export async function findByPhone(studioId: string, e164: string, excludeId?: string) {
  return await all<{ id: string; display_name: string; pipeline_stage: string }>(
    "SELECT id, display_name, pipeline_stage FROM contacts WHERE studio_id = ? AND phone_e164 = ? AND merged_into IS NULL AND (? IS NULL OR id <> ?)",
    studioId,
    e164,
    excludeId ?? null,
    excludeId ?? null,
  );
}

export type ContactInput = {
  display_name?: string;
  phone?: string;
  preferred_language?: string | null;
  gender_form?: string | null;
  owner_id?: string | null;
  source?: string;
  interest?: string | null;
  tags?: string[];
  note?: string;
  allow_duplicate?: boolean;
};

async function validateOwner(ctx: Ctx, ownerId: string | null | undefined) {
  if (!ownerId) return;
  const okOwner = await one(
    "SELECT 1 FROM staff_memberships WHERE studio_id = ? AND user_id = ? AND active = 1",
    ctx.studio.id,
    ownerId,
  );
  if (!okOwner) throw invalid({ owner_id: "האחראי שנבחר אינו חלק מהצוות." });
}

const LANGS = new Set(["he", "ar", "en"]);

export async function createContact(ctx: Ctx, input: ContactInput, opts: { source?: string; actorId?: string | null } = {}) {
  assertCan(ctx, "contacts.edit");
  const name = (input.display_name ?? "").trim();
  const fields: Record<string, string> = {};
  if (!name) fields.display_name = "צריך שם.";
  if (name.length > 120) fields.display_name = "השם ארוך מדי.";
  const phone = normalizePhone(input.phone, ctx.studio.default_country);
  if (input.phone && !phone.valid) fields.phone = "מספר הטלפון לא נראה תקין. בדקו שוב.";
  if (input.preferred_language && !LANGS.has(input.preferred_language)) fields.preferred_language = "שפה לא נתמכת.";
  if (Object.keys(fields).length) throw invalid(fields);
  await validateOwner(ctx, input.owner_id);

  if (phone.e164 && !input.allow_duplicate) {
    const dupes = await findByPhone(ctx.studio.id, phone.e164);
    if (dupes.length) {
      throw new AppError("conflict", "כבר יש לקוח עם מספר הטלפון הזה.", { details: { duplicates: dupes } });
    }
  }
  const now = nowIso();
  const contactId = id("con");
  const isDuplicate = !!(phone.e164 && (await findByPhone(ctx.studio.id, phone.e164)).length);
  await tx(async () => {
    await run(
      `INSERT INTO contacts (id, studio_id, display_name, phone_e164, phone_raw, phone_valid, preferred_language, gender_form,
        pipeline_stage, owner_id, source, interest, tags, needs_review, review_reason, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      contactId,
      ctx.studio.id,
      name,
      phone.e164,
      phone.raw || null,
      phone.valid ? 1 : 0,
      input.preferred_language || null,
      input.gender_form || null,
      "new_lead",
      input.owner_id ?? null,
      opts.source ?? input.source ?? "manual",
      input.interest?.trim() || null,
      JSON.stringify((input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 20)),
      isDuplicate || !phone.valid ? 1 : 0,
      isDuplicate ? "duplicate_phone" : !phone.valid ? "missing_phone" : null,
      now,
      now,
    );
    await run(
      "INSERT INTO stage_changes (id, studio_id, contact_id, from_stage, to_stage, actor_id, created_at) VALUES (?,?,?,?,?,?,?)",
      id("stg"),
      ctx.studio.id,
      contactId,
      null,
      "new_lead",
      ctx.userId,
      now,
    );
    if (input.note?.trim()) addNoteRaw(ctx.studio.id, contactId, input.note.trim(), ctx.userId, false);
  });
  return await getContact(ctx, contactId);
}

export type ContactPatch = ContactInput & {
  version: number;
  pipeline_stage?: Stage;
  stage_reason?: string;
  archived?: boolean;
  needs_review?: boolean;
};

const CLOSING = new Set<Stage>(["lost"]);

export async function updateContact(ctx: Ctx, contactId: string, patch: ContactPatch) {
  assertCan(ctx, "contacts.edit");
  const current = await getContact(ctx, contactId);
  if (typeof patch.version !== "number") throw invalid({ version: "חסרה גרסה." });
  if (patch.version !== current.version) throw conflict();

  const sets: string[] = [];
  const params: unknown[] = [];
  const fields: Record<string, string> = {};
  const diff: Record<string, [unknown, unknown]> = {};
  const set = (col: keyof ContactRow, value: unknown) => {
    if ((current as unknown as Record<string, unknown>)[col] === value) return;
    sets.push(`${col} = ?`);
    params.push(value);
    diff[col] = [(current as unknown as Record<string, unknown>)[col], value];
  };

  if (patch.display_name !== undefined) {
    const name = patch.display_name.trim();
    if (!name) fields.display_name = "צריך שם.";
    else set("display_name", name);
  }
  let phoneChanged = false;
  if (patch.phone !== undefined) {
    const phone = normalizePhone(patch.phone, ctx.studio.default_country);
    if (patch.phone && !phone.valid) fields.phone = "מספר הטלפון לא נראה תקין. בדקו שוב.";
    else if (phone.e164 !== current.phone_e164) {
      if (phone.e164 && !patch.allow_duplicate) {
        const dupes = await findByPhone(ctx.studio.id, phone.e164, contactId);
        if (dupes.length) throw new AppError("conflict", "כבר יש לקוח עם מספר הטלפון הזה.", { details: { duplicates: dupes } });
      }
      set("phone_e164", phone.e164);
      set("phone_raw", phone.raw || null);
      set("phone_valid", phone.valid ? 1 : 0);
      phoneChanged = true;
    }
  }
  if (patch.preferred_language !== undefined) {
    if (patch.preferred_language && !LANGS.has(patch.preferred_language)) fields.preferred_language = "שפה לא נתמכת.";
    else set("preferred_language", patch.preferred_language || null);
  }
  if (patch.gender_form !== undefined) set("gender_form", patch.gender_form === "f" || patch.gender_form === "m" ? patch.gender_form : null);
  if (patch.owner_id !== undefined) {
    await validateOwner(ctx, patch.owner_id);
    set("owner_id", patch.owner_id || null);
  }
  if (patch.source !== undefined) set("source", patch.source || "manual");
  if (patch.interest !== undefined) set("interest", patch.interest?.trim() || null);
  if (patch.tags !== undefined) set("tags", JSON.stringify(patch.tags.map((t) => t.trim()).filter(Boolean).slice(0, 20)));
  if (patch.archived !== undefined) set("archived", patch.archived ? 1 : 0);
  if (patch.needs_review !== undefined) {
    set("needs_review", patch.needs_review ? 1 : 0);
    if (!patch.needs_review) set("review_reason", null);
  }

  let stageChange: { from: Stage; to: Stage; reason: string | null } | null = null;
  if (patch.pipeline_stage && patch.pipeline_stage !== current.pipeline_stage) {
    if (!STAGES.includes(patch.pipeline_stage)) fields.pipeline_stage = "שלב לא מוכר.";
    const reason = patch.stage_reason?.trim() || null;
    const reopening = CLOSING.has(current.pipeline_stage);
    if ((CLOSING.has(patch.pipeline_stage) || reopening) && !reason) {
      fields.stage_reason = reopening ? "כתבו למה פותחים מחדש." : "כתבו סיבה קצרה לסגירה.";
    }
    if (patch.pipeline_stage === "converted") {
      const hasMembership = await one(
        "SELECT 1 FROM memberships WHERE contact_id = ? AND studio_id = ? AND cancelled_at IS NULL",
        contactId,
        ctx.studio.id,
      );
      if (!hasMembership && !reason) {
        fields.stage_reason = "כדי לסמן 'הפך למנוי' צריך מנוי מקושר או אסמכתה (למשל מספר קבלה).";
      }
    }
    set("pipeline_stage", patch.pipeline_stage);
    set("stage_reason", reason);
    stageChange = { from: current.pipeline_stage, to: patch.pipeline_stage, reason };
  }
  if (Object.keys(fields).length) throw invalid(fields);
  if (!sets.length) return current;

  const now = nowIso();
  await tx(async () => {
    const res = await run(
      `UPDATE contacts SET ${sets.join(", ")}, version = version + 1, updated_at = ? WHERE id = ? AND studio_id = ? AND version = ?`,
      ...params,
      now,
      contactId,
      ctx.studio.id,
      patch.version,
    );
    if (res.changes !== 1) throw conflict();
    if (stageChange) {
      await run(
        "INSERT INTO stage_changes (id, studio_id, contact_id, from_stage, to_stage, reason, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
        id("stg"),
        ctx.studio.id,
        contactId,
        stageChange.from,
        stageChange.to,
        stageChange.reason,
        ctx.userId,
        now,
      );
    }
    if (phoneChanged) {
      await audit({ studioId: ctx.studio.id, actorId: ctx.userId, action: "contact.phone_changed", entity: "contact", entityId: contactId, diff: { phone: diff.phone_e164 } });
      await invalidateDrafts(ctx.studio.id, contactId, "phone_changed");
    }
    if (patch.owner_id !== undefined && diff.owner_id) {
      // Reassignment moves open tasks without duplicating them.
      await run(
        "UPDATE tasks SET assignee_id = ?, version = version + 1, updated_at = ? WHERE contact_id = ? AND studio_id = ? AND status IN ('open','in_progress','snoozed') AND (assignee_id IS NULL OR assignee_id = ?)",
        patch.owner_id || null,
        now,
        contactId,
        ctx.studio.id,
        current.owner_id,
      );
    }
  });
  return await getContact(ctx, contactId);
}

export async function invalidateDrafts(studioId: string, contactId: string, reason: string) {
  await run(
    "UPDATE message_drafts SET status = 'invalidated', invalid_reason = ?, updated_at = ? WHERE studio_id = ? AND contact_id = ? AND status IN ('ready','edited')",
    reason,
    nowIso(),
    studioId,
    contactId,
  );
}

/** Do-not-contact and channel preference (spec Customer Profile, AC-06). */
export async function setContactPreference(
  ctx: Ctx,
  contactId: string,
  allowed: boolean,
  reason: string | null,
  source = "staff",
) {
  assertCan(ctx, "contacts.edit");
  await getContact(ctx, contactId);
  await setPreferenceRaw(ctx.studio.id, contactId, allowed, reason, source, ctx.userId, null);
  if (!allowed) invalidateDrafts(ctx.studio.id, contactId, "contact_blocked");
  await audit({
    studioId: ctx.studio.id,
    actorId: ctx.userId,
    action: allowed ? "preference.allowed" : "preference.blocked",
    entity: "contact",
    entityId: contactId,
    reason,
  });
}

export async function setPreferenceRaw(
  studioId: string,
  contactId: string,
  allowed: boolean,
  reason: string | null,
  source: string,
  actorId: string | null,
  noticeVersion: string | null,
) {
  const now = nowIso();
  await run(
    `INSERT INTO contact_preferences (contact_id, studio_id, channel, allowed, reason, source, updated_by, updated_at)
     VALUES (?,?, 'whatsapp', ?,?,?,?,?)
     ON CONFLICT(contact_id, channel) DO UPDATE SET allowed = excluded.allowed, reason = excluded.reason, source = excluded.source, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    contactId,
    studioId,
    allowed ? 1 : 0,
    reason,
    source,
    actorId,
    now,
  );
  await run(
    "INSERT INTO consent_events (id, studio_id, contact_id, channel, allowed, source, notice_version, reason, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    id("cns"),
    studioId,
    contactId,
    "whatsapp",
    allowed ? 1 : 0,
    source,
    noticeVersion,
    reason,
    actorId,
    now,
  );
}

async function addNoteRaw(studioId: string, contactId: string, body: string, authorId: string | null, isPrivate: boolean) {
  await run(
    "INSERT INTO notes (id, studio_id, contact_id, body, is_private, author_id, created_at) VALUES (?,?,?,?,?,?,?)",
    id("not"),
    studioId,
    contactId,
    body.slice(0, 4000),
    isPrivate ? 1 : 0,
    authorId,
    nowIso(),
  );
}

export async function addNote(ctx: Ctx, contactId: string, body: string, isPrivate: boolean) {
  assertCan(ctx, "contacts.edit");
  await getContact(ctx, contactId);
  if (!body.trim()) throw invalid({ body: "ההערה ריקה." });
  await addNoteRaw(ctx.studio.id, contactId, body.trim(), ctx.userId, isPrivate);
}

export async function listNotes(ctx: Ctx, contactId: string) {
  await getContact(ctx, contactId);
  return await all<{ id: string; body: string; is_private: number; author_name: string | null; created_at: string }>(
    "SELECT n.id, n.body, n.is_private, u.name AS author_name, n.created_at FROM notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.contact_id = ? AND n.studio_id = ? ORDER BY n.created_at DESC",
    contactId,
    ctx.studio.id,
  );
}

export type TimelineItem = { at: string; kind: string; title: string; detail?: string | null; actor?: string | null };

export async function contactTimeline(ctx: Ctx, contactId: string): Promise<TimelineItem[]> {
  await getContact(ctx, contactId);
  const sid = ctx.studio.id;
  const items: TimelineItem[] = [];
  for (const s of await all<{ created_at: string; from_stage: string | null; to_stage: string; reason: string | null; actor: string | null }>(
    "SELECT s.created_at, s.from_stage, s.to_stage, s.reason, u.name AS actor FROM stage_changes s LEFT JOIN users u ON u.id = s.actor_id WHERE s.contact_id = ? AND s.studio_id = ?",
    contactId,
    sid,
  )) {
    items.push({ at: s.created_at, kind: "stage", title: s.from_stage ? `stage:${s.from_stage}>${s.to_stage}` : `stage:created`, detail: s.reason, actor: s.actor });
  }
  for (const e of await all<{ occurred_at: string; event_type: string; outcome: string | null; note: string | null; channel: string; actor: string | null }>(
    "SELECT e.occurred_at, e.event_type, e.outcome, e.note, e.channel, u.name AS actor FROM interaction_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.contact_id = ? AND e.studio_id = ?",
    contactId,
    sid,
  )) {
    items.push({ at: e.occurred_at, kind: "interaction", title: `event:${e.event_type}${e.outcome ? `:${e.outcome}` : ""}`, detail: e.note, actor: e.actor });
  }
  for (const n of await all<{ created_at: string; body: string; actor: string | null }>(
    "SELECT n.created_at, n.body, u.name AS actor FROM notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.contact_id = ? AND n.studio_id = ?",
    contactId,
    sid,
  )) {
    items.push({ at: n.created_at, kind: "note", title: "note", detail: n.body, actor: n.actor });
  }
  for (const c of await all<{ created_at: string; allowed: number; reason: string | null; source: string; actor: string | null }>(
    "SELECT c.created_at, c.allowed, c.reason, c.source, u.name AS actor FROM consent_events c LEFT JOIN users u ON u.id = c.actor_id WHERE c.contact_id = ? AND c.studio_id = ?",
    contactId,
    sid,
  )) {
    items.push({ at: c.created_at, kind: "consent", title: c.allowed ? "consent:allowed" : "consent:blocked", detail: c.reason, actor: c.actor ?? c.source });
  }
  return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 200);
}

/** Merge preview: both records + chosen values. Moves tasks, notes, memberships, attendance and history (spec CRM-03). */
export async function mergeContacts(
  ctx: Ctx,
  keepId: string,
  dropId: string,
  choose: { display_name?: "keep" | "drop"; phone?: "keep" | "drop"; owner?: "keep" | "drop" },
  reason: string,
) {
  assertCan(ctx, "contacts.merge");
  if (keepId === dropId) throw invalid({ drop_id: "בחרו שני תיקים שונים." });
  const keep = await getContact(ctx, keepId);
  const drop = await getContact(ctx, dropId);
  const sid = ctx.studio.id;
  const now = nowIso();
  const name = choose.display_name === "drop" ? drop.display_name : keep.display_name;
  const phoneFrom = choose.phone === "drop" ? drop : keep;
  const owner = choose.owner === "drop" ? drop.owner_id : keep.owner_id;
  await tx(async () => {
    for (const table of ["tasks", "notes", "memberships", "interaction_events", "suggestions", "message_drafts", "registrations", "member_activations", "member_sessions", "stage_changes", "consent_events"]) {
      await run(`UPDATE ${table} SET contact_id = ? WHERE contact_id = ? AND studio_id = ?`, keepId, dropId, sid);
    }
    // Attendance is unique per person+session: keep the existing row on conflict.
    await run(
      "UPDATE attendance SET contact_id = ? WHERE contact_id = ? AND studio_id = ? AND session_id NOT IN (SELECT session_id FROM attendance WHERE contact_id = ?)",
      keepId,
      dropId,
      sid,
      keepId,
    );
    const tags = Array.from(new Set([...keep.tags, ...drop.tags]));
    await run(
      `UPDATE contacts SET display_name = ?, phone_e164 = ?, phone_raw = ?, phone_valid = ?, owner_id = ?, tags = ?,
         external_id = COALESCE(external_id, ?), needs_review = 0, review_reason = NULL, version = version + 1, updated_at = ?
       WHERE id = ? AND studio_id = ?`,
      name,
      phoneFrom.phone_e164,
      phoneFrom.phone_raw,
      phoneFrom.phone_valid,
      owner,
      JSON.stringify(tags),
      drop.external_id,
      now,
      keepId,
      sid,
    );
    await run(
      "UPDATE contacts SET merged_into = ?, archived = 1, external_id = NULL, version = version + 1, updated_at = ? WHERE id = ? AND studio_id = ?",
      keepId,
      now,
      dropId,
      sid,
    );
    // A block on either record stays in force.
    const blocked = !keep.contact_allowed || !drop.contact_allowed;
    if (blocked && keep.contact_allowed) {
      await setPreferenceRaw(sid, keepId, false, drop.contact_block_reason ?? "merged", "merge", ctx.userId, null);
    }
    await audit({ studioId: sid, actorId: ctx.userId, action: "contact.merged", entity: "contact", entityId: keepId, reason, diff: { merged: dropId, keep: keep.display_name, drop: drop.display_name } });
  });
  return await getContact(ctx, keepId);
}

export async function staffList(studioId: string) {
  return await all<{ id: string; name: string; role: string }>(
    "SELECT u.id, u.name, m.role FROM staff_memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = ? AND m.active = 1 ORDER BY u.name",
    studioId,
  );
}

export async function allTags(studioId: string): Promise<string[]> {
  return await all<{ value: string }>(
    "SELECT DISTINCT json_each.value AS value FROM contacts, json_each(contacts.tags) WHERE contacts.studio_id = ? AND contacts.merged_into IS NULL ORDER BY value",
    studioId,
  ).map((r) => r.value);
}
