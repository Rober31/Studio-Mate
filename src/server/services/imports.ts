// CSV import with dry run, idempotent commit and safe rollback (spec §22, CSV-01, AC-I01).

import { all, batch, one, placeholders, run, tx } from "../db";
import { AppError, invalid, notFound } from "../errors";
import { assertCan, type Ctx } from "../permissions";
import { hashObject, id, nowIso, parseJson, sha256 } from "../util";
import { normalizePhone } from "../phone";
import { audit } from "../audit";
import { endDateToExclusive, startOfLocalDay } from "../time";
import { STAGES } from "./contacts";
import { markEvaluationStale } from "./followups";

export const IMPORT_FIELDS = [
  "display_name",
  "first_name",
  "last_name",
  "phone",
  "stage",
  "owner",
  "source",
  "interest",
  "tags",
  "note",
  "language",
  "external_id",
  "plan_name",
  "membership_start",
  "membership_end",
  "balance",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type DateFormat = "DD/MM/YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 10_000;

/** RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  // Detect delimiter from the header line.
  const firstLine = s.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const HEADER_GUESS: Record<ImportField, RegExp> = {
  display_name: /^(name|full ?name|שם( מלא)?|الاسم|item|לקוח)$/i,
  first_name: /^(first ?name|שם פרטי)$/i,
  last_name: /^(last ?name|שם משפחה)$/i,
  phone: /(phone|mobile|tel|טלפון|נייד|هاتف)/i,
  stage: /(stage|status|שלב|סטטוס)/i,
  owner: /(owner|person|אחראי|משויך)/i,
  source: /(source|מקור)/i,
  interest: /(interest|תחום)/i,
  tags: /(tags?|תגיות)/i,
  note: /(note|notes|הערות?|updates?)/i,
  language: /(language|שפה)/i,
  external_id: /^(id|external ?id|item id|מזהה)$/i,
  plan_name: /(plan|membership|מנוי|מסלול)/i,
  membership_start: /(start|תחיל|התחל)/i,
  membership_end: /(end|expir|סיום|תוקף)/i,
  balance: /(balance|remaining|יתרה|שיעורים)/i,
};

export function guessMapping(headers: string[]): Record<string, ImportField | ""> {
  const used = new Set<ImportField>();
  const mapping: Record<string, ImportField | ""> = {};
  for (const h of headers) {
    const field = (Object.keys(HEADER_GUESS) as ImportField[]).find((f) => !used.has(f) && HEADER_GUESS[f].test(h.trim()));
    mapping[h] = field ?? "";
    if (field) used.add(field);
  }
  return mapping;
}

function parseDate(value: string, fmt: DateFormat): string | null {
  const v = value.trim();
  if (!v) return null;
  let y: number, m: number, d: number;
  const parts = v.split(/[./\-\s]/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some(Number.isNaN)) return null;
  if (fmt === "YYYY-MM-DD") [y, m, d] = parts;
  else if (fmt === "DD/MM/YYYY") [d, m, y] = parts;
  else [m, d, y] = parts;
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const STAGE_ALIASES: Record<string, string> = {
  "ליד": "new_lead",
  "ליד חדש": "new_lead",
  "new": "new_lead",
  "lead": "new_lead",
  "נוצר קשר": "contacted",
  "contacted": "contacted",
  "ניסיון": "trial_scheduled",
  "שיעור ניסיון": "trial_scheduled",
  "trial": "trial_scheduled",
  "השתתף בניסיון": "trial_attended",
  "ממתין": "decision_pending",
  "מנוי": "converted",
  "member": "converted",
  "customer": "converted",
  "לא רלוונטי": "lost",
  "lost": "lost",
};

type RowResult = {
  row: number;
  status: "create" | "update" | "needs_review" | "error";
  message: string | null;
  data: Record<string, string>;
  matchId?: string | null;
};

export async function previewImport(
  ctx: Ctx,
  input: { file_name?: string; content?: string; mapping?: Record<string, string>; date_format?: DateFormat },
) {
  assertCan(ctx, "imports");
  const content = input.content ?? "";
  if (!content.trim()) throw invalid({ content: "הקובץ ריק." });
  if (Buffer.byteLength(content, "utf8") > MAX_BYTES) throw invalid({ content: "הקובץ גדול מ-10MB. פצלו אותו לכמה קבצים." });
  if (content.includes("�")) throw invalid({ content: "נראה שהקובץ לא שמור בקידוד UTF-8. שמרו אותו מחדש כ-CSV UTF-8." });
  const rows = parseCsv(content);
  if (rows.length < 2) throw invalid({ content: "לא נמצאו שורות מתחת לכותרות." });
  const headers = rows[0].map((h) => h.trim());
  if (rows.length - 1 > MAX_ROWS) throw invalid({ content: `יותר מ-${MAX_ROWS.toLocaleString()} שורות. פצלו את הקובץ.` });
  const mapping = input.mapping && Object.keys(input.mapping).length ? input.mapping : guessMapping(headers);
  const dateFormat: DateFormat = input.date_format ?? "DD/MM/YYYY";
  const fields = Object.values(mapping);
  if (!fields.includes("display_name") && !fields.includes("first_name")) {
    return { needsMapping: true, headers, mapping, sample: rows.slice(1, 6) };
  }

  // Two queries for the whole file; matching happens in memory.
  const [owners, existing] = await Promise.all([
    all<{ id: string; name: string; email: string }>(
      "SELECT u.id, u.name, u.email FROM staff_memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = ? AND m.active = 1",
      ctx.studio.id,
    ),
    all<{ id: string; phone_e164: string | null; external_id: string | null; source: string }>(
      "SELECT id, phone_e164, external_id, source FROM contacts WHERE studio_id = ? AND merged_into IS NULL AND archived = 0 ORDER BY created_at",
      ctx.studio.id,
    ),
  ]);
  const byExternal = new Map<string, string>();
  const byPhone = new Map<string, string>();
  for (const c of existing) {
    if (c.source === "import" && c.external_id && !byExternal.has(c.external_id)) byExternal.set(c.external_id, c.id);
    if (c.phone_e164 && !byPhone.has(c.phone_e164)) byPhone.set(c.phone_e164, c.id);
  }
  const seenPhones = new Map<string, number>();
  const results: RowResult[] = [];
  rows.slice(1).forEach((cells, i) => {
    const rowNum = i + 2;
    const data: Record<string, string> = {};
    headers.forEach((h, idx) => {
      const f = mapping[h];
      if (f) data[f] = (cells[idx] ?? "").trim();
    });
    const name = (data.display_name || [data.first_name, data.last_name].filter(Boolean).join(" ")).trim();
    if (!name) {
      results.push({ row: rowNum, status: "error", message: "חסר שם", data });
      return;
    }
    data.display_name = name;
    const problems: string[] = [];
    const phone = normalizePhone(data.phone, ctx.studio.default_country);
    if (data.phone && !phone.valid) problems.push("טלפון לא תקין");
    if (!data.phone) problems.push("חסר טלפון");
    if (phone.e164) data.phone_e164 = phone.e164;
    if (data.stage) {
      const st = STAGE_ALIASES[data.stage.trim().toLowerCase()] ?? (STAGES as readonly string[]).find((s) => s === data.stage.trim());
      if (st) data.stage_key = st;
      else problems.push(`שלב לא מוכר: ${data.stage}`);
    }
    if (data.owner) {
      const o = owners.find((x) => x.email.toLowerCase() === data.owner.toLowerCase() || x.name === data.owner);
      if (o) data.owner_id = o.id;
      else problems.push(`אחראי לא מוכר: ${data.owner}`);
    }
    for (const key of ["membership_start", "membership_end"] as const) {
      if (data[key]) {
        const d = parseDate(data[key], dateFormat);
        if (!d) {
          results.push({ row: rowNum, status: "error", message: `תאריך לא תקין (${data[key]}). בדקו את פורמט התאריך.`, data });
          return;
        }
        data[`${key}_iso`] = d;
      }
    }
    if (data.balance && !/^-?\d+$/.test(data.balance)) {
      results.push({ row: rowNum, status: "error", message: `יתרה לא תקינה (${data.balance})`, data });
      return;
    }
    if (data.plan_name && !data.membership_start_iso) {
      results.push({ row: rowNum, status: "error", message: "יש מסלול בלי תאריך התחלה", data });
      return;
    }
    // Match: source id first, then normalized phone (name alone is never a key).
    let match: { id: string } | undefined;
    if (data.external_id && byExternal.has(data.external_id)) match = { id: byExternal.get(data.external_id)! };
    if (!match && phone.valid && phone.e164 && byPhone.has(phone.e164)) match = { id: byPhone.get(phone.e164)! };
    if (phone.valid && phone.e164) {
      const prev = seenPhones.get(phone.e164);
      if (prev && !match) {
        problems.push(`אותו טלפון כמו שורה ${prev}`);
      }
      seenPhones.set(phone.e164, rowNum);
    }
    const status: RowResult["status"] = match ? "update" : problems.length ? "needs_review" : "create";
    results.push({ row: rowNum, status, message: problems.join(" · ") || null, data, matchId: match?.id ?? null });
  });

  const fileHash = sha256(content);
  const previewHash = hashObject({ fileHash, mapping, dateFormat });
  const counts = {
    total: results.length,
    create: results.filter((r) => r.status === "create").length,
    update: results.filter((r) => r.status === "update").length,
    needs_review: results.filter((r) => r.status === "needs_review").length,
    error: results.filter((r) => r.status === "error").length,
  };
  const batchId = id("imp");
  await run(
    `INSERT INTO import_batches (id, studio_id, kind, file_name, file_hash, mapping, preview_hash, status, total_rows, ok_rows, error_rows, duplicate_rows, raw, created_by, created_at)
     VALUES (?,?, 'contacts', ?,?,?,?, 'previewed', ?,?,?,?,?,?,?)`,
    batchId,
    ctx.studio.id,
    (input.file_name ?? "import.csv").slice(0, 200),
    fileHash,
    JSON.stringify({ mapping, dateFormat }),
    previewHash,
    counts.total,
    counts.create + counts.update + counts.needs_review,
    counts.error,
    counts.update,
    JSON.stringify(results),
    ctx.userId,
    nowIso(),
  );
  return { needsMapping: false, batchId, previewHash, headers, mapping, counts, rows: results.slice(0, 500) };
}

const CHUNK = 300;

export async function commitImport(ctx: Ctx, batchId: string, previewHash: string) {
  assertCan(ctx, "imports");
  const sid = ctx.studio.id;
  const tz = ctx.studio.timezone;
  const now = nowIso();
  let rowCount = 0;
  // The whole commit is one write transaction: status checks, lookups and all writes.
  const replay = await tx(async () => {
    const batchRow = await one<{ id: string; status: string; preview_hash: string; raw: string; mapping: string }>(
      "SELECT id, status, preview_hash, raw, mapping FROM import_batches WHERE id = ? AND studio_id = ?",
      batchId,
      sid,
    );
    if (!batchRow) throw notFound("הייבוא");
    if (batchRow.preview_hash !== previewHash) throw new AppError("conflict", "התצוגה המקדימה השתנתה. הכינו תצוגה מקדימה מחדש.");
    if (batchRow.status === "committed") return true; // idempotent replay (AC-I01)
    if (batchRow.status !== "previewed") throw new AppError("conflict", "הייבוא הזה כבר בוטל.");
    // Same file committed earlier in another batch: do not duplicate.
    const earlier = await one<{ id: string }>(
      "SELECT id FROM import_batches WHERE studio_id = ? AND preview_hash = ? AND status = 'committed' AND id <> ?",
      sid,
      previewHash,
      batchId,
    );
    if (earlier) throw new AppError("conflict", "הקובץ הזה כבר יובא בעבר עם אותו מיפוי. אין צורך לייבא שוב.", { details: { batchId: earlier.id } });

    const rows = parseJson<RowResult[]>(batchRow.raw, []);
    rowCount = rows.length;
    const [active, plans, memberships] = await Promise.all([
      all<{ id: string; phone_e164: string | null }>("SELECT id, phone_e164 FROM contacts WHERE studio_id = ? AND merged_into IS NULL AND archived = 0", sid),
      all<{ id: string; name: string }>("SELECT id, name FROM plans WHERE studio_id = ?", sid),
      all<{ id: string; contact_id: string; plan_id: string; starts_at: string }>(
        "SELECT id, contact_id, plan_id, starts_at FROM memberships WHERE studio_id = ? AND authority = 'external'",
        sid,
      ),
    ]);
    const activeIds = new Set(active.map((c) => c.id));
    const phones = new Set(active.map((c) => c.phone_e164).filter(Boolean) as string[]);
    const planIds = new Map<string, string>();
    for (const p of plans) if (!planIds.has(p.name)) planIds.set(p.name, p.id);
    const extMemberships = new Map(memberships.map((m) => [`${m.contact_id}|${m.plan_id}|${m.starts_at}`, m.id]));

    const stmts: [string, ...unknown[]][] = [];
    const getPlan = (name: string, hasBalance: boolean) => {
      const key = name.trim();
      const existingId = planIds.get(key);
      if (existingId) return existingId;
      const pid = id("pln");
      stmts.push([
        "INSERT INTO plans (id, studio_id, name, type, sessions_granted, validity_days, deducts, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)",
        pid,
        sid,
        key,
        hasBalance ? "punch_period" : "period",
        hasBalance ? 10 : null,
        30,
        hasBalance ? 1 : 0,
        now,
        now,
      ]);
      planIds.set(key, pid);
      return pid;
    };

    for (const r of rows) {
      if (r.status === "error") {
        stmts.push(["INSERT OR IGNORE INTO import_row_results (id, batch_id, studio_id, row_number, status, message, data) VALUES (?,?,?,?,?,?,?)", id("irr"), batchId, sid, r.row, "error", r.message, JSON.stringify(r.data)]);
        continue;
      }
      const d = r.data;
      let contactId = r.matchId ?? null;
      let status = "created";
      if (contactId && activeIds.has(contactId)) {
        // Update only empty fields; never overwrite data staff already verified.
        stmts.push([
          `UPDATE contacts SET interest = COALESCE(interest, ?), owner_id = COALESCE(owner_id, ?), external_id = COALESCE(external_id, ?),
             preferred_language = COALESCE(preferred_language, ?), version = version + 1, updated_at = ? WHERE id = ?`,
          d.interest || null,
          d.owner_id || null,
          d.external_id || null,
          ["he", "ar", "en"].includes(d.language) ? d.language : null,
          now,
          contactId,
        ]);
        status = "updated";
      } else {
        contactId = id("con");
        const phone = normalizePhone(d.phone, ctx.studio.default_country);
        const dupPhone = !!(phone.valid && phone.e164 && phones.has(phone.e164));
        if (phone.e164) phones.add(phone.e164);
        activeIds.add(contactId);
        const review = r.status === "needs_review" || dupPhone;
        stmts.push([
          `INSERT INTO contacts (id, studio_id, display_name, phone_e164, phone_raw, phone_valid, preferred_language, pipeline_stage, owner_id, source, external_id,
             interest, tags, needs_review, review_reason, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?, 'import', ?,?,?,?,?,?,?)`,
          contactId,
          sid,
          d.display_name,
          phone.e164,
          d.phone || null,
          phone.valid ? 1 : 0,
          ["he", "ar", "en"].includes(d.language) ? d.language : null,
          d.stage_key || "new_lead",
          d.owner_id || null,
          d.external_id || null,
          d.interest || null,
          JSON.stringify((d.tags || "").split(/[,;|]/).map((t) => t.trim()).filter(Boolean).slice(0, 20)),
          review ? 1 : 0,
          review ? (r.message || "duplicate_phone").slice(0, 200) : null,
          now,
          now,
        ]);
        stmts.push([
          "INSERT INTO stage_changes (id, studio_id, contact_id, from_stage, to_stage, reason, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
          id("stg"),
          sid,
          contactId,
          null,
          d.stage_key || "new_lead",
          `ייבוא ${batchId}`,
          ctx.userId,
          now,
        ]);
        if (d.note) stmts.push(["INSERT INTO notes (id, studio_id, contact_id, body, is_private, author_id, created_at) VALUES (?,?,?,?,0,?,?)", id("not"), sid, contactId, d.note.slice(0, 4000), ctx.userId, now]);
        status = review ? "needs_review" : "created";
      }
      if (d.plan_name && d.membership_start_iso) {
        const planId = getPlan(d.plan_name, !!d.balance);
        const startsAt = startOfLocalDay(d.membership_start_iso, tz).toISOString();
        const endsAt = d.membership_end_iso ? endDateToExclusive(d.membership_end_iso, tz) : null;
        const key = `${contactId}|${planId}|${startsAt}`;
        const existingId = extMemberships.get(key);
        if (existingId) {
          stmts.push([
            "UPDATE memberships SET ends_at = ?, external_balance = ?, source_updated_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND (source_updated_at IS NULL OR source_updated_at <= ?)",
            endsAt,
            d.balance ? Number(d.balance) : null,
            now,
            now,
            existingId,
            now,
          ]);
        } else {
          const mid = id("mem");
          extMemberships.set(key, mid);
          stmts.push([
            `INSERT INTO memberships (id, studio_id, contact_id, plan_id, authority, external_id, starts_at, ends_at, external_balance, source_updated_at, reference, created_by, created_at, updated_at)
             VALUES (?,?,?,?, 'external', ?,?,?,?,?,?,?,?,?)`,
            mid,
            sid,
            contactId,
            planId,
            d.external_id || null,
            startsAt,
            endsAt,
            d.balance ? Number(d.balance) : null,
            now,
            `ייבוא ${batchId}`,
            ctx.userId,
            now,
            now,
          ]);
        }
      }
      stmts.push([
        "INSERT OR IGNORE INTO import_row_results (id, batch_id, studio_id, row_number, status, message, contact_id, data) VALUES (?,?,?,?,?,?,?,?)",
        id("irr"),
        batchId,
        sid,
        r.row,
        status,
        r.message,
        contactId,
        JSON.stringify(d),
      ]);
    }
    stmts.push(["UPDATE import_batches SET status = 'committed', committed_at = ? WHERE id = ?", now, batchId]);
    stmts.push([
      `INSERT INTO integration_connections (id, studio_id, provider, name, status, freshness_hours, last_success_at, created_at, updated_at)
       VALUES (?,?, 'csv', 'ייבוא קבצים', 'active', ?,?,?,?)
       ON CONFLICT(studio_id, provider) DO UPDATE SET status = 'active', last_success_at = excluded.last_success_at, updated_at = excluded.updated_at`,
      id("int"),
      sid,
      ctx.studio.settings.importFreshnessHours,
      now,
      now,
      now,
    ]);
    stmts.push([
      "INSERT INTO audit_events (id, studio_id, actor_id, action, entity, entity_id, diff, created_at) VALUES (?,?,?,?,?,?,?,?)",
      id("aud"),
      sid,
      ctx.userId,
      "import.committed",
      "import_batch",
      batchId,
      JSON.stringify({ rows: rows.length }),
      now,
    ]);
    for (let i = 0; i < stmts.length; i += CHUNK) await batch(stmts.slice(i, i + CHUNK));
    return false;
  });
  if (!replay && rowCount) await markEvaluationStale(sid);
  return importReport(ctx, batchId);
}

export async function importReport(ctx: Ctx, batchId: string) {
  assertCan(ctx, "imports");
  const batchRow = await one<{ id: string; file_name: string; status: string; total_rows: number; created_at: string; committed_at: string | null }>(
    "SELECT id, file_name, status, total_rows, created_at, committed_at FROM import_batches WHERE id = ? AND studio_id = ?",
    batchId,
    ctx.studio.id,
  );
  if (!batchRow) throw notFound("הייבוא");
  const results = await all<{ row_number: number; status: string; message: string | null; contact_id: string | null; data: string }>(
    "SELECT row_number, status, message, contact_id, data FROM import_row_results WHERE batch_id = ? ORDER BY row_number",
    batchId,
  );
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return {
    batch: batchRow,
    counts,
    rows: results.map((r) => ({ row: r.row_number, status: r.status, message: r.message, contactId: r.contact_id, name: parseJson<Record<string, string>>(r.data, {}).display_name ?? "" })),
  };
}

export async function listImports(ctx: Ctx) {
  assertCan(ctx, "imports");
  return await all<{ id: string; file_name: string; status: string; total_rows: number; ok_rows: number; error_rows: number; created_at: string; committed_at: string | null; created_by_name: string | null }>(
    "SELECT b.id, b.file_name, b.status, b.total_rows, b.ok_rows, b.error_rows, b.created_at, b.committed_at, u.name AS created_by_name FROM import_batches b LEFT JOIN users u ON u.id = b.created_by WHERE b.studio_id = ? AND b.status <> 'previewed' ORDER BY b.created_at DESC LIMIT 50",
    ctx.studio.id,
  );
}

/** Rollback is allowed only while the imported records are untouched (spec CSV-01). */
export async function rollbackImport(ctx: Ctx, batchId: string) {
  assertCan(ctx, "imports");
  const sid = ctx.studio.id;
  const result = await tx(async () => {
    const batchRow = await one<{ status: string }>("SELECT status FROM import_batches WHERE id = ? AND studio_id = ?", batchId, sid);
    if (!batchRow) throw notFound("הייבוא");
    if (batchRow.status !== "committed") throw new AppError("conflict", "אפשר לבטל רק ייבוא שבוצע.");
    const created = (
      await all<{ contact_id: string }>(
        "SELECT contact_id FROM import_row_results WHERE batch_id = ? AND studio_id = ? AND status IN ('created','needs_review') AND contact_id IS NOT NULL",
        batchId,
        sid,
      )
    ).map((r) => r.contact_id);
    // Grouped checks: a record counts as touched if it was edited or has any activity.
    const touched = new Set<string>();
    for (let i = 0; i < created.length; i += 500) {
      const ids = created.slice(i, i + 500);
      const ph = placeholders(ids.length);
      const [versions, activity] = await Promise.all([
        all<{ id: string; version: number }>(`SELECT id, version FROM contacts WHERE id IN (${ph})`, ...ids),
        all<{ contact_id: string }>(
          `SELECT contact_id FROM tasks WHERE contact_id IN (${ph})
           UNION SELECT contact_id FROM interaction_events WHERE contact_id IN (${ph})
           UNION SELECT contact_id FROM attendance WHERE contact_id IN (${ph})
           UNION SELECT contact_id FROM memberships WHERE authority = 'local' AND contact_id IN (${ph})`,
          ...ids,
          ...ids,
          ...ids,
          ...ids,
        ),
      ]);
      const found = new Map(versions.map((v) => [v.id, v.version]));
      for (const cid of ids) if (!found.has(cid) || found.get(cid)! > 1) touched.add(cid);
      for (const a of activity) touched.add(a.contact_id);
    }
    if (touched.size) {
      throw new AppError("conflict", `כבר בוצעו שינויים ב-${touched.size} תיקים מהייבוא, לכן אי אפשר לבטל אותו אוטומטית. אפשר לתקן ידנית או לשחזר לסביבת בדיקה.`);
    }
    const now = nowIso();
    const stmts: [string, ...unknown[]][] = [];
    for (let i = 0; i < created.length; i += 500) {
      const ids = created.slice(i, i + 500);
      const ph = placeholders(ids.length);
      stmts.push([`UPDATE contacts SET archived = 1, merged_into = NULL, external_id = NULL, needs_review = 0, version = version + 1, updated_at = ? WHERE studio_id = ? AND id IN (${ph})`, now, sid, ...ids]);
      stmts.push([`UPDATE memberships SET cancelled_at = ?, cancel_reason = 'ביטול ייבוא' WHERE studio_id = ? AND authority = 'external' AND cancelled_at IS NULL AND contact_id IN (${ph})`, now, sid, ...ids]);
    }
    stmts.push(["UPDATE import_batches SET status = 'rolled_back' WHERE id = ?", batchId]);
    stmts.push([
      "INSERT INTO audit_events (id, studio_id, actor_id, action, entity, entity_id, diff, created_at) VALUES (?,?,?,?,?,?,?,?)",
      id("aud"),
      sid,
      ctx.userId,
      "import.rolled_back",
      "import_batch",
      batchId,
      JSON.stringify({ archived: created.length }),
      now,
    ]);
    await batch(stmts);
    return { archived: created.length };
  });
  await markEvaluationStale(sid);
  return result;
}

/** Neutralizes values that a spreadsheet could execute as formulas (CSV injection). */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return "﻿" + [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n");
}

export async function exportContactsCsv(ctx: Ctx) {
  assertCan(ctx, "export");
  const rows = await all<{ display_name: string; phone_e164: string | null; pipeline_stage: string; owner: string | null; source: string; interest: string | null; tags: string; allowed: number | null; created_at: string }>(
    `SELECT c.display_name, c.phone_e164, c.pipeline_stage, u.name AS owner, c.source, c.interest, c.tags, p.allowed, c.created_at
       FROM contacts c LEFT JOIN users u ON u.id = c.owner_id LEFT JOIN contact_preferences p ON p.contact_id = c.id AND p.channel = 'whatsapp'
      WHERE c.studio_id = ? AND c.merged_into IS NULL AND c.archived = 0 ORDER BY c.display_name`,
    ctx.studio.id,
  );
  await audit({ studioId: ctx.studio.id, actorId: ctx.userId, action: "contacts.exported", entity: "contact", diff: { rows: rows.length } });
  return toCsv(
    ["name", "phone", "stage", "owner", "source", "interest", "tags", "whatsapp_allowed", "created_at"],
    rows.map((r) => [r.display_name, r.phone_e164, r.pipeline_stage, r.owner, r.source, r.interest, parseJson<string[]>(r.tags, []).join("; "), r.allowed === 0 ? "no" : "yes", r.created_at]),
  );
}
