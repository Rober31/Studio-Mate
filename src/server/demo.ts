// Synthetic demo studio (names and numbers are sample data). Used by `npm run seed`
// and automatically by demo deployments (STUDIOMATE_DEMO=1).

import { run, one, all } from "./db";
import { createStudioWithOwner } from "./services/team";
import { getStudio } from "./studio";
import type { Ctx, Role } from "./permissions";
import { createContact, setContactPreference } from "./services/contacts";
import { savePlan, createMembership } from "./services/memberships";
import { saveSession, commitCheckIn } from "./services/attendance";
import { createTask } from "./services/tasks";
import { submitRegistration } from "./services/public";
import { evaluateStudio } from "./services/followups";
import { hashPassword, id, nowIso, addDays } from "./util";
import { localDate, addLocalDays } from "./time";

export const DEMO_LOGIN = { email: "demo@studiomate.app", password: "studiomate-demo" };

export async function seedDemo(force = false) {
if (!force && (await one("SELECT 1 FROM studios LIMIT 1"))) return null;

const OWNER_EMAIL = "demo@studiomate.app";
const PASSWORD = "studiomate-demo";
const { studioId, userId: ownerId } = await createStudioWithOwner({
  studioName: "סטודיו נשימה · פילאטיס",
  ownerName: "מאיה לוי",
  email: OWNER_EMAIL,
  password: PASSWORD,
  timezone: "Asia/Jerusalem",
  modules: ["crm", "ai", "qr"],
  slug: force ? undefined : "neshima",
});

async function addStaff(name: string, email: string, role: Role) {
  const now = nowIso();
  let u = await one<{ id: string }>("SELECT id FROM users WHERE email = ?", email);
  if (!u) {
    u = { id: id("usr") };
    await run("INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?,?,?,?,?,?)", u.id, email, name, hashPassword(PASSWORD), now, now);
  }
  await run("INSERT OR IGNORE INTO staff_memberships (id, studio_id, user_id, role, scope, active, created_at) VALUES (?,?,?,?, 'all', 1, ?)", id("stm"), studioId, u.id, role, now);
  return u.id;
}
const staffId = await addStaff("נועה כהן", "staff@studiomate.app", "staff");
const instructorId = await addStaff("דנה אברהם", "instructor@studiomate.app", "instructor");

const studio = (await getStudio(studioId))!;
const ctx: Ctx = { userId: ownerId, name: "מאיה לוי", email: OWNER_EMAIL, role: "owner", scope: "all", studio, sessionId: "seed" };
const tz = studio.timezone;
const today = localDate(new Date(), tz);

const monthly = await savePlan(ctx, { name: "מנוי חודשי", type: "period", validity_days: 30, price: "420" });
const card10 = await savePlan(ctx, { name: "כרטיסייה 10 שיעורים", type: "punch_period", sessions_granted: 10, validity_days: 90, price: "900" });
const card5 = await savePlan(ctx, { name: "כרטיסייה 5 שיעורים", type: "punch", sessions_granted: 5, price: "480" });
const trial = await savePlan(ctx, { name: "שיעור ניסיון", type: "trial", sessions_granted: 1, validity_days: 14 });

const NAMES = [
  "לינה חורי", "נור עבד אלחי", "ראמי סלאמה", "שירה גולן", "יעל מזרחי", "תמר פרץ", "אורית ביטון", "מיכל אזולאי",
  "רוני שפירא", "הדר כץ", "עדי אוחיון", "ליאור דהן", "סיון אלון", "נטע רוזן", "גלית חדד", "רינת שושן",
  "אביטל ברק", "מאיה סגל", "ענבל לוין", "קרן יוסף", "דניאל עמר", "איילת גבאי", "שני וקנין", "מורן אלמוג",
  "ריטה נסאר", "סמאח ח'טיב", "יוליה קוגן", "אנה פרידמן", "טל בן דוד", "אסנת קליין",
];
const phone = (i: number) => `05${["0", "2", "4", "8"][i % 4]}-${String(1000000 + i * 7919).slice(0, 7)}`;

const contacts: string[] = [];
for (const [i, name] of NAMES.entries()) {
  const c = await createContact(
    ctx,
    {
      display_name: name,
      phone: phone(i),
      preferred_language: i % 9 === 1 || i === 24 || i === 25 ? "ar" : "he",
      owner_id: i % 3 === 0 ? staffId : ownerId,
      source: ["instagram", "referral", "website", "walk_in", "facebook"][i % 5],
      interest: ["פילאטיס מכשירים", "פילאטיס מזרן", "הריון ואחרי לידה", "שיקום גב"][i % 4],
      tags: i % 4 === 0 ? ["בוקר"] : i % 5 === 0 ? ["ערב", "VIP"] : [],
    },
    { source: ["instagram", "referral", "website", "walk_in", "facebook"][i % 5] },
  );
  contacts.push(c.id);
}

// Backdate creation for a realistic history.
for (const [i, cid] of contacts.entries()) {
  const created = addDays(nowIso(), -(60 - i * 2));
  await run("UPDATE contacts SET created_at = ?, updated_at = ? WHERE id = ?", created, created, cid);
  await run("UPDATE stage_changes SET created_at = ? WHERE contact_id = ?", created, cid);
}

const start = (daysAgo: number) => addLocalDays(today, -daysAgo);

// Members with various states.
await createMembership(ctx, { contact_id: contacts[1], plan_id: monthly, start_date: start(27) }); // ends in ~3 days → R03
await createMembership(ctx, { contact_id: contacts[2], plan_id: monthly, start_date: start(26) }); // ends in ~4 days → R03
await createMembership(ctx, { contact_id: contacts[3], plan_id: monthly, start_date: start(10) });
await createMembership(ctx, { contact_id: contacts[4], plan_id: card10, start_date: start(40) });
await createMembership(ctx, { contact_id: contacts[5], plan_id: card5, start_date: start(30) });
await createMembership(ctx, { contact_id: contacts[6], plan_id: monthly, start_date: start(20) }); // inactive → R05
await createMembership(ctx, { contact_id: contacts[7], plan_id: card10, start_date: start(15) });
await createMembership(ctx, { contact_id: contacts[8], plan_id: monthly, start_date: start(36) }); // expired → R07 (off by default)
await createMembership(ctx, { contact_id: contacts[9], plan_id: card10, start_date: start(5) });
await createMembership(ctx, { contact_id: contacts[10], plan_id: monthly, start_date: start(2) });
await createMembership(ctx, { contact_id: contacts[11], plan_id: card5, start_date: start(12) });

// Sessions: last 3 weeks + next week, Sun–Thu mornings and evenings.
const sessionIds: { id: string; daysAgo: number }[] = [];
for (let d = 21; d >= -6; d--) {
  const date = addLocalDays(today, -d);
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (dow === 5 || dow === 6) continue;
  const morning = await saveSession(ctx, { title: "פילאטיס מכשירים · בוקר", date, start: "08:00", end: "08:55", trainer_id: instructorId });
  const evening = await saveSession(ctx, { title: "פילאטיס מזרן · ערב", date, start: "19:00", end: "19:55", trainer_id: d % 2 ? instructorId : null });
  sessionIds.push({ id: morning.id, daysAgo: d }, { id: evening.id, daysAgo: d });
}

// Attendance history (local deductions where relevant). Contact 6 stops attending 16+ days ago.
async function attend(contactIdx: number, s: { id: string; daysAgo: number }) {
  try {
    const r = await commitCheckIn(studio, { contactId: contacts[contactIdx], sessionId: s.id, channel: "manual", actorId: instructorId });
    const when = addDays(nowIso(), -s.daysAgo);
    await run("UPDATE attendance SET checked_in_at = ? WHERE id = ?", when, r.attendance_id);
    await run("UPDATE balance_entries SET created_at = ? WHERE attendance_id = ?", when, r.attendance_id);
  } catch {
    /* not eligible on that date */
  }
}
for (const s of sessionIds.filter((x) => x.daysAgo > 0)) {
  if (s.daysAgo % 2 === 0) await attend(3, s);
  if (s.daysAgo % 3 === 0) await attend(4, s);
  if (s.daysAgo % 4 === 0 && s.daysAgo < 28) await attend(5, s);
  if (s.daysAgo >= 16 && s.daysAgo % 5 === 0) await attend(6, s);
  if (s.daysAgo % 2 === 1 && s.daysAgo < 14) await attend(7, s);
  if (s.daysAgo % 3 === 1) await attend(1, s);
  if (s.daysAgo === 3) await attend(9, s);
}
// Card owner 4 → low balance; card owner 11 → low balance.
for (const s of sessionIds.filter((x) => x.daysAgo > 0 && x.daysAgo < 12).slice(0, 3)) await attend(11, s);

// Trials: contact 12 attended a trial 2 days ago without membership → R02.
await createMembership(ctx, { contact_id: contacts[12], plan_id: trial, start_date: start(5) });
const trialSession = sessionIds.find((s) => s.daysAgo === 2) ?? sessionIds.find((s) => s.daysAgo === 3)!;
await attend(12, trialSession);
await createMembership(ctx, { contact_id: contacts[13], plan_id: trial, start_date: start(8) });
await attend(13, sessionIds.find((s) => s.daysAgo === 4) ?? trialSession);

// Lost lead with reason and a do-not-contact request.
await run("UPDATE contacts SET pipeline_stage = 'lost', stage_reason = 'עברה לגור בצפון' WHERE id = ?", contacts[20]);
await setContactPreference(ctx, contacts[21], false, "ביקשה שלא ישלחו לה הודעות");

// A confirmed contact for a few leads so not every lead appears.
for (const i of [14, 15, 16, 17, 24, 25, 26, 27, 28]) {
  await run(
    "INSERT INTO interaction_events (id, studio_id, contact_id, channel, event_type, evidence_type, outcome, note, marketing, occurred_at, actor_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    id("evt"),
    studioId,
    contacts[i],
    "call",
    "outcome_recorded",
    "staff_entry",
    "needs_time",
    "רוצה לחשוב, לחזור אחרי החגים",
    1,
    addDays(nowIso(), -5),
    staffId,
  );
  await run("UPDATE contacts SET pipeline_stage = 'contacted' WHERE id = ?", contacts[i]);
}

// Manual follow-ups.
await createTask(ctx, { contact_id: contacts[14], title: "לחזור אחרי החגים כמו שסיכמנו", due_at: addDays(nowIso(), -1), assignee_id: staffId });
await createTask(ctx, { contact_id: contacts[16], title: "לשלוח פרטים על מסלול הריון", due_at: nowIso(), assignee_id: ownerId });
await createTask(ctx, { contact_id: contacts[17], title: "לבדוק אם מתאים לה שיעור ערב", due_at: addDays(nowIso(), 2), assignee_id: staffId });

// A partial imported record that needs review.
await run("UPDATE contacts SET phone_e164 = NULL, phone_raw = '052-12', phone_valid = 0, needs_review = 1, review_reason = 'טלפון לא תקין' WHERE id = ?", contacts[29]);

// A public QR registration.
await submitRegistration(studio, { request_id: `seed${Date.now()}`, name: "רעות אלמוג", phone: "054-7788990", interest: "פילאטיס מזרן", note: "מעדיפה שיעורי ערב", contact_allowed: true });

// Recent leads (no contact yet) → R01.
for (const i of [18, 19, 22, 23]) await run("UPDATE contacts SET created_at = ? WHERE id = ?", addDays(nowIso(), -(i % 3)), contacts[i]);

const res = await evaluateStudio((await getStudio(studioId))!);
const slug = (await one<{ slug: string }>("SELECT slug FROM studios WHERE id = ?", studioId))!.slug;
return { studioId, contacts: contacts.length, sessions: sessionIds.length, suggestions: res.created, slug, owner: OWNER_EMAIL, password: PASSWORD };
}
