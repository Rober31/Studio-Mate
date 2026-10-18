// Development / demo data. Run with: npm run seed  (refuses to run on a database that already has studios unless --force)
// All names and numbers are synthetic sample data.

import { db, run, one, all } from "../src/server/db";
import { createStudioWithOwner } from "../src/server/services/team";
import { getStudio } from "../src/server/studio";
import type { Ctx, Role } from "../src/server/permissions";
import { createContact, setContactPreference } from "../src/server/services/contacts";
import { savePlan, createMembership } from "../src/server/services/memberships";
import { saveSession, commitCheckIn } from "../src/server/services/attendance";
import { createTask } from "../src/server/services/tasks";
import { submitRegistration } from "../src/server/services/public";
import { evaluateStudio } from "../src/server/services/followups";
import { hashPassword, id, nowIso, addDays } from "../src/server/util";
import { localDate, addLocalDays } from "../src/server/time";

const force = process.argv.includes("--force");
db();
if (one("SELECT 1 FROM studios LIMIT 1") && !force) {
  console.log("Database already has data. Use --force to add another demo studio.");
  process.exit(0);
}

const OWNER_EMAIL = "demo@studiomate.app";
const PASSWORD = "studiomate-demo";
const { studioId, userId: ownerId } = createStudioWithOwner({
  studioName: "סטודיו נשימה · פילאטיס",
  ownerName: "מאיה לוי",
  email: OWNER_EMAIL,
  password: PASSWORD,
  timezone: "Asia/Jerusalem",
  modules: ["crm", "ai", "qr"],
  slug: force ? undefined : "neshima",
});

function addStaff(name: string, email: string, role: Role) {
  const now = nowIso();
  let u = one<{ id: string }>("SELECT id FROM users WHERE email = ?", email);
  if (!u) {
    u = { id: id("usr") };
    run("INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?,?,?,?,?,?)", u.id, email, name, hashPassword(PASSWORD), now, now);
  }
  run("INSERT OR IGNORE INTO staff_memberships (id, studio_id, user_id, role, scope, active, created_at) VALUES (?,?,?,?, 'all', 1, ?)", id("stm"), studioId, u.id, role, now);
  return u.id;
}
const staffId = addStaff("נועה כהן", "staff@studiomate.app", "staff");
const instructorId = addStaff("דנה אברהם", "instructor@studiomate.app", "instructor");

const studio = getStudio(studioId)!;
const ctx: Ctx = { userId: ownerId, name: "מאיה לוי", email: OWNER_EMAIL, role: "owner", scope: "all", studio, sessionId: "seed" };
const tz = studio.timezone;
const today = localDate(new Date(), tz);

const monthly = savePlan(ctx, { name: "מנוי חודשי", type: "period", validity_days: 30, price: "420" });
const card10 = savePlan(ctx, { name: "כרטיסייה 10 שיעורים", type: "punch_period", sessions_granted: 10, validity_days: 90, price: "900" });
const card5 = savePlan(ctx, { name: "כרטיסייה 5 שיעורים", type: "punch", sessions_granted: 5, price: "480" });
const trial = savePlan(ctx, { name: "שיעור ניסיון", type: "trial", sessions_granted: 1, validity_days: 14 });

const NAMES = [
  "לינה חורי", "נור עבד אלחי", "ראמי סלאמה", "שירה גולן", "יעל מזרחי", "תמר פרץ", "אורית ביטון", "מיכל אזולאי",
  "רוני שפירא", "הדר כץ", "עדי אוחיון", "ליאור דהן", "סיון אלון", "נטע רוזן", "גלית חדד", "רינת שושן",
  "אביטל ברק", "מאיה סגל", "ענבל לוין", "קרן יוסף", "דניאל עמר", "איילת גבאי", "שני וקנין", "מורן אלמוג",
  "ריטה נסאר", "סמאח ח'טיב", "יוליה קוגן", "אנה פרידמן", "טל בן דוד", "אסנת קליין",
];
const phone = (i: number) => `05${["0", "2", "4", "8"][i % 4]}-${String(1000000 + i * 7919).slice(0, 7)}`;

const contacts: string[] = [];
NAMES.forEach((name, i) => {
  const c = createContact(
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
});

// Backdate creation for a realistic history.
contacts.forEach((cid, i) => {
  const created = addDays(nowIso(), -(60 - i * 2));
  run("UPDATE contacts SET created_at = ?, updated_at = ? WHERE id = ?", created, created, cid);
  run("UPDATE stage_changes SET created_at = ? WHERE contact_id = ?", created, cid);
});

const start = (daysAgo: number) => addLocalDays(today, -daysAgo);

// Members with various states.
createMembership(ctx, { contact_id: contacts[1], plan_id: monthly, start_date: start(27) }); // ends in ~3 days → R03
createMembership(ctx, { contact_id: contacts[2], plan_id: monthly, start_date: start(26) }); // ends in ~4 days → R03
createMembership(ctx, { contact_id: contacts[3], plan_id: monthly, start_date: start(10) });
createMembership(ctx, { contact_id: contacts[4], plan_id: card10, start_date: start(40) });
createMembership(ctx, { contact_id: contacts[5], plan_id: card5, start_date: start(30) });
createMembership(ctx, { contact_id: contacts[6], plan_id: monthly, start_date: start(20) }); // inactive → R05
createMembership(ctx, { contact_id: contacts[7], plan_id: card10, start_date: start(15) });
createMembership(ctx, { contact_id: contacts[8], plan_id: monthly, start_date: start(36) }); // expired → R07 (off by default)
createMembership(ctx, { contact_id: contacts[9], plan_id: card10, start_date: start(5) });
createMembership(ctx, { contact_id: contacts[10], plan_id: monthly, start_date: start(2) });
createMembership(ctx, { contact_id: contacts[11], plan_id: card5, start_date: start(12) });

// Sessions: last 3 weeks + next week, Sun–Thu mornings and evenings.
const sessionIds: { id: string; daysAgo: number }[] = [];
for (let d = 21; d >= -6; d--) {
  const date = addLocalDays(today, -d);
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (dow === 5 || dow === 6) continue;
  const morning = saveSession(ctx, { title: "פילאטיס מכשירים · בוקר", date, start: "08:00", end: "08:55", trainer_id: instructorId });
  const evening = saveSession(ctx, { title: "פילאטיס מזרן · ערב", date, start: "19:00", end: "19:55", trainer_id: d % 2 ? instructorId : null });
  sessionIds.push({ id: morning.id, daysAgo: d }, { id: evening.id, daysAgo: d });
}

// Attendance history (local deductions where relevant). Contact 6 stops attending 16+ days ago.
function attend(contactIdx: number, s: { id: string; daysAgo: number }) {
  try {
    const r = commitCheckIn(studio, { contactId: contacts[contactIdx], sessionId: s.id, channel: "manual", actorId: instructorId });
    const when = addDays(nowIso(), -s.daysAgo);
    run("UPDATE attendance SET checked_in_at = ? WHERE id = ?", when, r.attendance_id);
    run("UPDATE balance_entries SET created_at = ? WHERE attendance_id = ?", when, r.attendance_id);
  } catch {
    /* not eligible on that date */
  }
}
for (const s of sessionIds.filter((x) => x.daysAgo > 0)) {
  if (s.daysAgo % 2 === 0) attend(3, s);
  if (s.daysAgo % 3 === 0) attend(4, s);
  if (s.daysAgo % 4 === 0 && s.daysAgo < 28) attend(5, s);
  if (s.daysAgo >= 16 && s.daysAgo % 5 === 0) attend(6, s);
  if (s.daysAgo % 2 === 1 && s.daysAgo < 14) attend(7, s);
  if (s.daysAgo % 3 === 1) attend(1, s);
  if (s.daysAgo === 3) attend(9, s);
}
// Card owner 4 → low balance; card owner 11 → low balance.
for (const s of sessionIds.filter((x) => x.daysAgo > 0 && x.daysAgo < 12).slice(0, 3)) attend(11, s);

// Trials: contact 12 attended a trial 2 days ago without membership → R02.
createMembership(ctx, { contact_id: contacts[12], plan_id: trial, start_date: start(5) });
const trialSession = sessionIds.find((s) => s.daysAgo === 2) ?? sessionIds.find((s) => s.daysAgo === 3)!;
attend(12, trialSession);
createMembership(ctx, { contact_id: contacts[13], plan_id: trial, start_date: start(8) });
attend(13, sessionIds.find((s) => s.daysAgo === 4) ?? trialSession);

// Lost lead with reason and a do-not-contact request.
run("UPDATE contacts SET pipeline_stage = 'lost', stage_reason = 'עברה לגור בצפון' WHERE id = ?", contacts[20]);
setContactPreference(ctx, contacts[21], false, "ביקשה שלא ישלחו לה הודעות");

// A confirmed contact for a few leads so not every lead appears.
for (const i of [14, 15]) {
  run(
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
  run("UPDATE contacts SET pipeline_stage = 'contacted' WHERE id = ?", contacts[i]);
}

// Manual follow-ups.
createTask(ctx, { contact_id: contacts[14], title: "לחזור אחרי החגים כמו שסיכמנו", due_at: addDays(nowIso(), -1), assignee_id: staffId });
createTask(ctx, { contact_id: contacts[16], title: "לשלוח פרטים על מסלול הריון", due_at: nowIso(), assignee_id: ownerId });
createTask(ctx, { contact_id: contacts[17], title: "לבדוק אם מתאים לה שיעור ערב", due_at: addDays(nowIso(), 2), assignee_id: staffId });

// A partial imported record that needs review.
run("UPDATE contacts SET phone_e164 = NULL, phone_raw = '052-12', phone_valid = 0, needs_review = 1, review_reason = 'טלפון לא תקין' WHERE id = ?", contacts[29]);

// A public QR registration.
submitRegistration(studio, { request_id: `seed${Date.now()}`, name: "רעות אלמוג", phone: "054-7788990", interest: "פילאטיס מזרן", note: "מעדיפה שיעורי ערב", contact_allowed: true });

// Recent leads (no contact yet) → R01.
for (const i of [18, 19, 22, 23]) run("UPDATE contacts SET created_at = ? WHERE id = ?", addDays(nowIso(), -(i % 3)), contacts[i]);

const res = evaluateStudio(getStudio(studioId)!);
console.log(`Seeded studio ${studioId} with ${contacts.length} contacts, ${sessionIds.length} sessions, ${res.created} follow-up suggestions.`);
console.log(`Owner: ${OWNER_EMAIL} / ${PASSWORD}`);
console.log(`Staff: staff@studiomate.app / ${PASSWORD} · Instructor: instructor@studiomate.app / ${PASSWORD}`);
console.log(`Public registration page: /s/${one<{ slug: string }>("SELECT slug FROM studios WHERE id = ?", studioId)!.slug}`);
void all;
