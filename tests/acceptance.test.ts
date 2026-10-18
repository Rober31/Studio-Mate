// Acceptance tests mapped to spec §38–§39 (AC-01…AC-12, AC-Q01…AC-Q08, AC-I01).
// Runs against an isolated temporary SQLite database with synthetic data.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sm-test-")), "test.db");
process.env.DATABASE_PATH = dbFile;
delete process.env.ANTHROPIC_API_KEY;

import { one, run, all } from "../src/server/db";
import { createStudioWithOwner } from "../src/server/services/team";
import { getStudio } from "../src/server/studio";
import type { Ctx } from "../src/server/permissions";
import { createContact, getContact, setContactPreference, updateContact } from "../src/server/services/contacts";
import { savePlan, createMembership, adjustBalance, getMembership } from "../src/server/services/memberships";
import { evaluateStudio, todayList } from "../src/server/services/followups";
import { prepareDraft, handoff, markSent } from "../src/server/services/drafts";
import { recordOutcome, createTask, updateTask } from "../src/server/services/tasks";
import { saveSession, commitCheckIn, reverseAttendance, issueChallenge, memberCheckIn } from "../src/server/services/attendance";
import { submitRegistration, createActivation, redeemActivation, memberFromToken } from "../src/server/services/public";
import { previewImport, commitImport, csvCell } from "../src/server/services/imports";
import { withIdempotency } from "../src/server/http";
import { normalizePhone } from "../src/server/phone";
import { endDateToExclusive, exclusiveToEndDate } from "../src/server/time";
import { validateOutput } from "../src/server/services/ai";
import { AppError } from "../src/server/errors";
import { addDays, nowIso } from "../src/server/util";

let ctx: Ctx;
let ctxB: Ctx;
let monthly: string;
let card: string;
let trial: string;

function mkCtx(studioId: string, userId: string): Ctx {
  return { userId, name: "בדיקה", email: "t@t", role: "owner", scope: "all", studio: getStudio(studioId)!, sessionId: "test" };
}
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
const daysAgo = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(Date.now() - n * 86_400_000));

function expectError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof AppError, `expected AppError, got ${e}`);
    assert.equal((e as AppError).code, code);
    return e as AppError;
  }
  assert.fail(`expected ${code}`);
}
async function expectErrorAsync(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (e) {
    assert.ok(e instanceof AppError, `expected AppError, got ${e}`);
    assert.equal((e as AppError).code, code);
    return;
  }
  assert.fail(`expected ${code}`);
}

before(() => {
  const a = createStudioWithOwner({ studioName: "A", ownerName: "Owner A", email: "a@test.dev", password: "password-123", timezone: "Asia/Jerusalem", modules: ["crm", "ai", "qr"] });
  const b = createStudioWithOwner({ studioName: "B", ownerName: "Owner B", email: "b@test.dev", password: "password-123", timezone: "Asia/Jerusalem", modules: ["crm", "ai", "qr"] });
  ctx = mkCtx(a.studioId, a.userId);
  ctxB = mkCtx(b.studioId, b.userId);
  monthly = savePlan(ctx, { name: "חודשי", type: "period", validity_days: 30 });
  card = savePlan(ctx, { name: "כרטיסייה 5", type: "punch", sessions_granted: 5 });
  trial = savePlan(ctx, { name: "ניסיון", type: "trial", sessions_granted: 1, validity_days: 14 });
});

test("phone normalization and inclusive end dates", () => {
  assert.equal(normalizePhone("050-123-4567").e164, "+972501234567");
  assert.equal(normalizePhone("+972 50 123 4567").e164, "+972501234567");
  assert.equal(normalizePhone("00972501234567").e164, "+972501234567");
  assert.equal(normalizePhone("12").valid, false);
  const ex = endDateToExclusive("2026-03-27", "Asia/Jerusalem"); // DST switch weekend in Israel
  assert.equal(exclusiveToEndDate(ex, "Asia/Jerusalem"), "2026-03-27");
});

test("AC-01 same phone in two formats is detected as a possible duplicate", () => {
  createContact(ctx, { display_name: "לינה", phone: "050-765-4321" });
  const err = expectError(() => createContact(ctx, { display_name: "לינה ח", phone: "+972507654321" }), "conflict");
  assert.ok((err.details as { duplicates: unknown[] }).duplicates.length === 1);
  assert.equal(all("SELECT id FROM contacts WHERE phone_e164 = '+972507654321'").length, 1);
});

test("AC-02 converting a lead keeps the same contact and history", () => {
  const c = createContact(ctx, { display_name: "נור", phone: "052-111-2233" });
  createMembership(ctx, { contact_id: c.id, plan_id: monthly, start_date: today() });
  const after = getContact(ctx, c.id);
  assert.equal(after.id, c.id);
  assert.equal(after.pipeline_stage, "converted");
  assert.ok(one("SELECT 1 FROM stage_changes WHERE contact_id = ? AND to_stage = 'converted'", c.id));
});

test("AC-03 evaluating R03 repeatedly creates one suggestion", () => {
  const c = createContact(ctx, { display_name: "ראמי", phone: "054-222-3344" });
  createMembership(ctx, { contact_id: c.id, plan_id: monthly, start_date: daysAgo(27) });
  evaluateStudio(ctx.studio);
  evaluateStudio(ctx.studio);
  evaluateStudio(ctx.studio);
  const rows = all("SELECT id FROM suggestions WHERE contact_id = ? AND rule_id = 'R03'", c.id);
  assert.equal(rows.length, 1);
  const list = todayList(ctx);
  assert.equal(list.cards.filter((x) => x.contactId === c.id).length, 1);
});

test("AC-04/AC-05 opening WhatsApp is not a confirmed follow-up; manual confirmation + outcome is", async () => {
  const c = createContact(ctx, { display_name: "שירה", phone: "053-333-4455" });
  evaluateStudio(ctx.studio);
  const s = one<{ id: string }>("SELECT id FROM suggestions WHERE contact_id = ? AND rule_id = 'R01'", c.id)!;
  const d = await prepareDraft(ctx, { contact_id: c.id, suggestion_id: s.id });
  assert.equal(d.generator, "template"); // AC-09: no AI key → safe template with warning
  assert.ok(d.warnings.includes("ai_not_configured"));
  const h = handoff(ctx, d.id);
  assert.match(h.url, /^https:\/\/wa\.me\/972533334455\?text=/);
  assert.equal(all("SELECT 1 FROM interaction_events WHERE contact_id = ? AND event_type = 'marked_sent'", c.id).length, 0);
  markSent(ctx, d.id);
  recordOutcome(ctx, { contact_id: c.id, draft_id: d.id, outcome: "interested", follow_up: { due_at: addDays(nowIso(), 2) } });
  const ev = one<{ evidence_type: string; actor_id: string }>("SELECT evidence_type, actor_id FROM interaction_events WHERE contact_id = ? AND event_type = 'marked_sent'", c.id)!;
  assert.equal(ev.evidence_type, "manual_confirmation");
  assert.equal(ev.actor_id, ctx.userId);
  assert.ok(one("SELECT 1 FROM tasks WHERE contact_id = ? AND status = 'open'", c.id));
  assert.equal(getContact(ctx, c.id).pipeline_stage, "contacted");
  assert.equal(one<{ status: string }>("SELECT status FROM suggestions WHERE id = ?", s.id)!.status, "completed");
});

test("AC-06 do-not-contact stops messages immediately, even with a saved draft", async () => {
  const c = createContact(ctx, { display_name: "יעל", phone: "050-444-5566" });
  const d = await prepareDraft(ctx, { contact_id: c.id });
  setContactPreference(ctx, c.id, false, "ביקשה");
  assert.equal(one<{ status: string }>("SELECT status FROM message_drafts WHERE id = ?", d.id)!.status, "invalidated");
  expectError(() => handoff(ctx, d.id), "conflict");
  await expectErrorAsync(() => prepareDraft(ctx, { contact_id: c.id }), "blocked");
  evaluateStudio(ctx.studio);
  assert.equal(todayList(ctx).cards.filter((x) => x.contactId === c.id).length, 0);
});

test("AC-07 renewal after the draft was prepared invalidates the old text", async () => {
  const c = createContact(ctx, { display_name: "תמר", phone: "050-555-6677" });
  const m = createMembership(ctx, { contact_id: c.id, plan_id: monthly, start_date: daysAgo(27) });
  evaluateStudio(ctx.studio);
  const s = one<{ id: string }>("SELECT id FROM suggestions WHERE contact_id = ? AND rule_id = 'R03'", c.id)!;
  const d = await prepareDraft(ctx, { contact_id: c.id, suggestion_id: s.id });
  createMembership(ctx, { contact_id: c.id, plan_id: monthly, start_date: today(), renewed_from: m.id });
  expectError(() => handoff(ctx, d.id), "conflict");
  assert.equal(one<{ status: string }>("SELECT status FROM message_drafts WHERE id = ?", d.id)!.status, "invalidated");
});

test("AC-09 model output validation rejects invented numbers, prices and links", () => {
  const facts = { rule: "R04" as const, first_name: "דנה", language: "he", balance: 2 };
  assert.deepEqual(validateOutput("היי דנה, נשארו 2 שיעורים", "he", facts), []);
  assert.ok(validateOutput("היי דנה, נשארו 3 שיעורים", "he", facts).length > 0);
  assert.ok(validateOutput("היי דנה, 20% הנחה!", "he", facts).length > 0);
  assert.ok(validateOutput("Hi Dana https://x.y", "en", facts).length > 0);
});

test("AC-10 'renewed' requires a documented membership or reference", () => {
  const c = createContact(ctx, { display_name: "אורית", phone: "050-666-7788" });
  expectError(() => recordOutcome(ctx, { contact_id: c.id, outcome: "renewed" }), "validation");
  recordOutcome(ctx, { contact_id: c.id, outcome: "renewed", renewal_reference: "קבלה 1234" });
  assert.ok(one("SELECT 1 FROM interaction_events WHERE contact_id = ? AND event_type = 'renewal'", c.id));
});

test("AC-11 two staff editing the same task get a clear conflict", () => {
  const c = createContact(ctx, { display_name: "מיכל", phone: "050-777-8899" });
  const t = createTask(ctx, { contact_id: c.id, title: "לחזור", due_at: nowIso() });
  updateTask(ctx, t.id, { version: t.version, action: "start" });
  expectError(() => updateTask(ctx, t.id, { version: t.version, action: "complete", outcome: "interested" }), "conflict");
});

test("AC-12 a user of studio B cannot read a contact of studio A", () => {
  const c = createContact(ctx, { display_name: "רוני", phone: "050-888-9900" });
  expectError(() => getContact(ctxB, c.id), "not_found");
  expectError(() => updateContact(ctxB, c.id, { version: 1, display_name: "x" }), "not_found");
});

test("AC-Q01 registration with an existing number: generic receipt, review task, no overwrite", () => {
  const c = createContact(ctx, { display_name: "הדר כץ", phone: "050-999-0011" });
  const res = submitRegistration(ctx.studio, { request_id: "req-aaaaaaaa", name: "מישהו אחר", phone: "0509990011", contact_allowed: true });
  assert.deepEqual(res, { status: "received" });
  assert.equal(getContact(ctx, c.id).display_name, "הדר כץ");
  assert.ok(one("SELECT 1 FROM tasks WHERE contact_id = ? AND reason_code = 'REG'", c.id));
  // Same request id again → no duplicate.
  submitRegistration(ctx.studio, { request_id: "req-aaaaaaaa", name: "מישהו אחר", phone: "0509990011" });
  assert.equal(all("SELECT 1 FROM registrations WHERE request_id = 'req-aaaaaaaa'").length, 1);
});

test("AC-Q02 a phone number alone never grants a member session", () => {
  assert.equal(memberFromToken(undefined, ctx.studio.id), null);
  assert.equal(memberFromToken("0509990011", ctx.studio.id), null);
});

test("AC-Q03/Q04 QR check-in: one attendance and one deduction under repeats; foreign/expired code rejected", () => {
  const c = createContact(ctx, { display_name: "גלית", phone: "052-123-0000" });
  const m = createMembership(ctx, { contact_id: c.id, plan_id: card, start_date: today() });
  const now = new Date();
  const hhmm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const s = saveSession(ctx, { title: "בוקר", date: today(), start: hhmm(new Date(now.getTime() - 5 * 60_000)), end: hhmm(new Date(now.getTime() + 50 * 60_000)) });
  const act = createActivation(ctx, c.id);
  const sess = redeemActivation(act.token);
  const member = memberFromToken(sess.sessionToken, ctx.studio.id)!;
  expectError(() => redeemActivation(act.token), "blocked"); // one-time link
  const ch = issueChallenge(ctx, s.id);
  const r1 = memberCheckIn(ctx.studio, member.contactId, ch.token);
  const r2 = memberCheckIn(ctx.studio, member.contactId, ch.token);
  assert.equal(r1.status, "checked_in");
  assert.equal(r2.status, "already_recorded");
  assert.equal(r1.attendance_id, r2.attendance_id);
  assert.equal(getMembership(ctx.studio.id, m.id).balance, 4);
  assert.equal(all("SELECT 1 FROM balance_entries WHERE membership_id = ? AND kind = 'deduction'", m.id).length, 1);
  // Code from another studio is rejected.
  expectError(() => memberCheckIn(ctxB.studio, member.contactId, ch.token), "blocked");
  // Expired code is rejected for someone not yet recorded.
  const c2 = createContact(ctx, { display_name: "קרן", phone: "052-123-0001" });
  createMembership(ctx, { contact_id: c2.id, plan_id: card, start_date: today() });
  run("UPDATE qr_challenges SET expires_at = ? WHERE session_id = ?", addDays(nowIso(), -1), s.id);
  expectError(() => memberCheckIn(ctx.studio, c2.id, ch.token), "blocked");
  assert.equal(all("SELECT 1 FROM attendance WHERE contact_id = ?", c2.id).length, 0);
});

test("AC-Q05 ineligible or paused member: no deduction, referred to reception", () => {
  const c = createContact(ctx, { display_name: "סיון", phone: "052-123-0002" });
  const s = saveSession(ctx, { title: "ערב", date: today(), start: "19:00", end: "20:00" });
  expectError(() => commitCheckIn(ctx.studio, { contactId: c.id, sessionId: s.id, channel: "qr", actorId: null }), "blocked");
  assert.equal(all("SELECT 1 FROM attendance WHERE contact_id = ?", c.id).length, 0);
});

test("AC-Q06 reversing attendance twice refunds once and keeps audit", () => {
  const c = createContact(ctx, { display_name: "נטע", phone: "052-123-0003" });
  const m = createMembership(ctx, { contact_id: c.id, plan_id: card, start_date: today() });
  const s = saveSession(ctx, { title: "צהריים", date: today(), start: "12:00", end: "13:00" });
  const r = commitCheckIn(ctx.studio, { contactId: c.id, sessionId: s.id, channel: "manual", actorId: ctx.userId });
  assert.equal(getMembership(ctx.studio.id, m.id).balance, 4);
  reverseAttendance(ctx, r.attendance_id, "נרשם בטעות");
  const again = reverseAttendance(ctx, r.attendance_id, "שוב");
  assert.equal(again.status, "already_reversed");
  assert.equal(getMembership(ctx.studio.id, m.id).balance, 5);
  assert.equal(all("SELECT 1 FROM balance_entries WHERE membership_id = ? AND kind = 'reversal'", m.id).length, 1);
  assert.ok(one("SELECT 1 FROM audit_events WHERE action = 'attendance.reversed' AND entity_id = ?", r.attendance_id));
});

test("trial attendance moves a lead to 'trial attended' and later raises R02", () => {
  const c = createContact(ctx, { display_name: "ענבל", phone: "052-123-0004" });
  createMembership(ctx, { contact_id: c.id, plan_id: trial, start_date: daysAgo(3) });
  const s = saveSession(ctx, { title: "ניסיון", date: daysAgo(2), start: "10:00", end: "11:00" });
  const r = commitCheckIn(ctx.studio, { contactId: c.id, sessionId: s.id, channel: "manual", actorId: ctx.userId });
  run("UPDATE attendance SET checked_in_at = ? WHERE id = ?", addDays(nowIso(), -2), r.attendance_id);
  assert.equal(getContact(ctx, c.id).pipeline_stage, "trial_attended");
  evaluateStudio(ctx.studio);
  assert.ok(one("SELECT 1 FROM suggestions WHERE contact_id = ? AND rule_id = 'R02' AND status = 'active'", c.id));
});

test("balance adjustment with the same Idempotency-Key is applied once", () => {
  const c = createContact(ctx, { display_name: "קרן י", phone: "052-123-0005" });
  const m = createMembership(ctx, { contact_id: c.id, plan_id: card, start_date: today() });
  const body = { delta: 2, reason: "פיצוי" };
  const call = () => withIdempotency(ctx.studio.id, "balance", "key-1", body, () => ({ status: 201, data: adjustBalance(ctx, m.id, 2, "פיצוי") }));
  call();
  const second = call();
  assert.equal(second.replayed, true);
  assert.equal(getMembership(ctx.studio.id, m.id).balance, 7);
  expectError(() => withIdempotency(ctx.studio.id, "balance", "key-1", { delta: 3, reason: "x" }, () => ({ status: 201, data: null })), "conflict");
});

test("AC-I01 committing the same import twice creates no extra records; CSV export is formula-safe", () => {
  const csv = "שם,טלפון,שלב\nאביטל ברק,050-1212121,ליד\nבלי טלפון,,ליד\n,050-3434343,ליד\nאביטל שוב,0501212121,ליד\n";
  const p = previewImport(ctx, { file_name: "t.csv", content: csv });
  assert.equal(p.needsMapping, false);
  if (p.needsMapping) return;
  assert.equal(p.counts!.error, 1);
  const r1 = commitImport(ctx, p.batchId!, p.previewHash!);
  const before = one<{ n: number }>("SELECT COUNT(*) AS n FROM contacts WHERE studio_id = ?", ctx.studio.id)!.n;
  const r2 = commitImport(ctx, p.batchId!, p.previewHash!);
  const after = one<{ n: number }>("SELECT COUNT(*) AS n FROM contacts WHERE studio_id = ?", ctx.studio.id)!.n;
  assert.equal(before, after);
  assert.deepEqual(r1.counts, r2.counts);
  assert.ok(r1.rows.some((r) => r.status === "error"));
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("+972"), "'+972");
});
