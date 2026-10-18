// Studio setup, staff invitations, roles and access recovery (S01, S13).

import { all, batch, one, run, tx } from "../db";
import crypto from "node:crypto";
import { AppError, invalid, notFound } from "../errors";
import { assertCan, type Ctx, type Role } from "../permissions";
import { addDays, addHours, hashPassword, id, nowIso, sha256, token, verifyPassword } from "../util";
import { audit } from "../audit";
import { revokeUserSessions } from "../auth";
import { DEFAULT_SETTINGS, getStudio, saveStudio, mergeSettings, type ModuleKey, type StudioSettings } from "../studio";

function validatePassword(password: string | undefined): string | null {
  if (!password || password.length < 10) return "סיסמה של 10 תווים לפחות.";
  if (password.length > 200) return "הסיסמה ארוכה מדי.";
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function hasAnyStudio(): Promise<boolean> {
  return !!await one("SELECT 1 FROM studios LIMIT 1");
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
  return `${base || "studio"}-${token(3).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

/** First-run setup: creates the first studio and its owner. Disabled once a studio exists. */
/** In production the first-run screen requires SETUP_CODE so strangers cannot claim a fresh deployment. */
export function setupCodeRequired(): boolean {
  return process.env.NODE_ENV === "production";
}

function checkSetupCode(code: string | undefined) {
  if (!setupCodeRequired()) return;
  const expected = process.env.SETUP_CODE;
  if (!expected) {
    throw new AppError("forbidden", "ההקמה נעולה: צריך להגדיר משתנה SETUP_CODE בהגדרות האחסון (למשל ב-Vercel) ואז לנסות שוב.");
  }
  const a = crypto.createHash("sha256").update(code ?? "").digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  if (!crypto.timingSafeEqual(a, b)) throw invalid({ setup_code: "קוד ההקמה אינו נכון." });
}

export async function setupStudio(input: { studio_name?: string; owner_name?: string; email?: string; password?: string; timezone?: string; modules?: ModuleKey[]; setup_code?: string }) {
  if (await hasAnyStudio()) throw new AppError("forbidden", "המערכת כבר הוגדרה.");
  checkSetupCode(input.setup_code);
  const fields: Record<string, string> = {};
  if (!input.studio_name?.trim()) fields.studio_name = "מה שם הסטודיו?";
  if (!input.owner_name?.trim()) fields.owner_name = "מה השם שלך?";
  if (!input.email || !EMAIL_RE.test(input.email)) fields.email = "כתובת אימייל לא תקינה.";
  const pw = validatePassword(input.password);
  if (pw) fields.password = pw;
  if (Object.keys(fields).length) throw invalid(fields);
  return await createStudioWithOwner({
    studioName: input.studio_name!.trim(),
    ownerName: input.owner_name!.trim(),
    email: input.email!.trim(),
    password: input.password!,
    timezone: input.timezone || "Asia/Jerusalem",
    modules: input.modules?.length ? input.modules : ["crm", "ai", "qr"],
  });
}

export async function createStudioWithOwner(p: { studioName: string; ownerName: string; email: string; password: string; timezone: string; modules: ModuleKey[]; slug?: string }) {
  const now = nowIso();
  const studioId = id("std");
  const existingUser = await one<{ id: string }>("SELECT id FROM users WHERE email = ?", p.email);
  const userId = existingUser?.id ?? id("usr");
  const stmts: [string, ...unknown[]][] = [
    [
      "INSERT INTO studios (id, name, slug, timezone, locale, enabled_modules, settings, status, created_at, updated_at) VALUES (?,?,?,?, 'he', ?,?, 'active', ?,?)",
      studioId,
      p.studioName,
      p.slug ?? slugify(p.studioName),
      p.timezone,
      JSON.stringify(p.modules),
      JSON.stringify(DEFAULT_SETTINGS),
      now,
      now,
    ],
  ];
  if (!existingUser) {
    stmts.push(["INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?,?,?,?,?,?)", userId, p.email, p.ownerName, hashPassword(p.password), now, now]);
  }
  stmts.push(["INSERT INTO staff_memberships (id, studio_id, user_id, role, scope, active, created_at) VALUES (?,?,?, 'owner', 'all', 1, ?)", id("stm"), studioId, userId, now]);
  for (const [provider, name] of [
    ["csv", "ייבוא קבצים (CSV)"],
    ["booking_app", "אפליקציית ההזמנות"],
    ["monday", "Monday"],
  ]) {
    stmts.push([
      "INSERT INTO integration_connections (id, studio_id, provider, name, status, freshness_hours, created_at, updated_at) VALUES (?,?,?,?, 'not_connected', 24, ?,?)",
      id("int"),
      studioId,
      provider,
      name,
      now,
      now,
    ]);
  }
  stmts.push([
    "INSERT INTO audit_events (id, studio_id, actor_id, action, entity, entity_id, created_at) VALUES (?,?,?,?,?,?,?)",
    id("aud"),
    studioId,
    userId,
    "studio.created",
    "studio",
    studioId,
    now,
  ]);
  // One atomic round trip.
  await batch(stmts);
  return { studioId, userId };
}

export async function listTeam(ctx: Ctx) {
  assertCan(ctx, "users");
  const members = await all<{ user_id: string; name: string; email: string; role: Role; scope: string; active: number; created_at: string; last_seen: string | null }>(
    `SELECT m.user_id, u.name, u.email, m.role, m.scope, m.active, m.created_at,
            (SELECT MAX(last_seen_at) FROM auth_sessions s WHERE s.user_id = m.user_id AND s.studio_id = m.studio_id) AS last_seen
       FROM staff_memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = ? ORDER BY m.active DESC, u.name`,
    ctx.studio.id,
  );
  const invites = await all<{ id: string; email: string; name: string | null; role: Role; expires_at: string; created_at: string }>(
    "SELECT id, email, name, role, expires_at, created_at FROM invitations WHERE studio_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC",
    ctx.studio.id,
    nowIso(),
  );
  return { members, invites };
}

export async function inviteStaff(ctx: Ctx, input: { email?: string; name?: string; role?: Role; scope?: "all" | "assigned" }) {
  assertCan(ctx, "users");
  const fields: Record<string, string> = {};
  if (!input.email || !EMAIL_RE.test(input.email.trim())) fields.email = "כתובת אימייל לא תקינה.";
  if (!input.role || !["owner", "staff", "instructor"].includes(input.role)) fields.role = "בחרו תפקיד.";
  if (Object.keys(fields).length) throw invalid(fields);
  const email = input.email!.trim();
  const already = await one(
    "SELECT 1 FROM staff_memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = ? AND u.email = ? AND m.active = 1",
    ctx.studio.id,
    email,
  );
  if (already) throw invalid({ email: "המשתמש כבר בצוות." });
  const raw = token(24);
  const now = nowIso();
  await run(
    "INSERT INTO invitations (id, studio_id, email, name, role, scope, token_hash, expires_at, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    id("inv"),
    ctx.studio.id,
    email,
    input.name?.trim() || null,
    input.role,
    input.scope === "assigned" ? "assigned" : "all",
    sha256(raw),
    addDays(now, 7),
    ctx.userId,
    now,
  );
  await audit({ studioId: ctx.studio.id, actorId: ctx.userId, action: "user.invited", entity: "invitation", reason: null, diff: { email, role: input.role } });
  return { token: raw, expires_at: addDays(now, 7) };
}

export async function revokeInvite(ctx: Ctx, inviteId: string) {
  assertCan(ctx, "users");
  await run("UPDATE invitations SET revoked_at = ? WHERE id = ? AND studio_id = ?", nowIso(), inviteId, ctx.studio.id);
}

export async function inviteInfo(rawToken: string) {
  return await one<{ id: string; email: string; name: string | null; role: Role; studio_name: string; has_user: number }>(
    `SELECT i.id, i.email, i.name, i.role, s.name AS studio_name, EXISTS (SELECT 1 FROM users u WHERE u.email = i.email) AS has_user
       FROM invitations i JOIN studios s ON s.id = i.studio_id
      WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?`,
    sha256(rawToken),
    nowIso(),
  );
}

export async function acceptInvite(rawToken: string, input: { name?: string; password?: string }) {
  const inv = await one<{ id: string; studio_id: string; email: string; role: Role; scope: string }>(
    "SELECT id, studio_id, email, role, scope FROM invitations WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?",
    sha256(rawToken),
    nowIso(),
  );
  if (!inv) throw new AppError("blocked", "ההזמנה כבר שומשה או שפג תוקפה. בקשו הזמנה חדשה.");
  const existing = await one<{ id: string; password_hash: string }>("SELECT id, password_hash FROM users WHERE email = ?", inv.email);
  const now = nowIso();
  let userId: string;
  if (existing) {
    if (!input.password || !verifyPassword(input.password, existing.password_hash)) throw invalid({ password: "הסיסמה של החשבון הקיים אינה נכונה." });
    userId = existing.id;
  } else {
    const fields: Record<string, string> = {};
    if (!input.name?.trim()) fields.name = "מה השם שלך?";
    const pw = validatePassword(input.password);
    if (pw) fields.password = pw;
    if (Object.keys(fields).length) throw invalid(fields);
    userId = id("usr");
  }
  await tx(async () => {
    if (!existing) await run("INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?,?,?,?,?,?)", userId, inv.email, input.name!.trim(), hashPassword(input.password!), now, now);
    await run(
      `INSERT INTO staff_memberships (id, studio_id, user_id, role, scope, active, created_at) VALUES (?,?,?,?,?,1,?)
       ON CONFLICT(studio_id, user_id) DO UPDATE SET role = excluded.role, scope = excluded.scope, active = 1`,
      id("stm"),
      inv.studio_id,
      userId,
      inv.role,
      inv.scope,
      now,
    );
    await run("UPDATE invitations SET accepted_at = ? WHERE id = ?", now, inv.id);
    await audit({ studioId: inv.studio_id, actorId: userId, action: "user.joined", entity: "user", entityId: userId, diff: { role: inv.role } });
  });
  return { userId, studioId: inv.studio_id };
}

export async function updateMember(ctx: Ctx, userId: string, input: { role?: Role; scope?: "all" | "assigned"; active?: boolean }) {
  assertCan(ctx, "users");
  const m = await one<{ role: Role; active: number }>("SELECT role, active FROM staff_memberships WHERE studio_id = ? AND user_id = ?", ctx.studio.id, userId);
  if (!m) throw notFound("המשתמש");
  const owners = (await one<{ n: number }>("SELECT COUNT(*) AS n FROM staff_memberships WHERE studio_id = ? AND role = 'owner' AND active = 1", ctx.studio.id))!.n;
  const losingOwner = m.role === "owner" && m.active === 1 && ((input.role && input.role !== "owner") || input.active === false);
  if (losingOwner && owners <= 1) throw new AppError("blocked", "חייב להישאר לפחות בעלים פעיל אחד.");
  if (input.role && !["owner", "staff", "instructor"].includes(input.role)) throw invalid({ role: "תפקיד לא מוכר." });
  await tx(async () => {
    await run(
      "UPDATE staff_memberships SET role = COALESCE(?, role), scope = COALESCE(?, scope), active = COALESCE(?, active) WHERE studio_id = ? AND user_id = ?",
      input.role ?? null,
      input.scope ?? null,
      input.active === undefined ? null : input.active ? 1 : 0,
      ctx.studio.id,
      userId,
    );
    if (input.active === false) await revokeUserSessions(userId, ctx.studio.id);
    await audit({ studioId: ctx.studio.id, actorId: ctx.userId, action: "user.permissions_changed", entity: "user", entityId: userId, diff: input });
  });
}

/** Owner-issued one-time reset link (no email provider is configured). */
export async function createResetLink(ctx: Ctx, userId: string) {
  assertCan(ctx, "users");
  if (!await one("SELECT 1 FROM staff_memberships WHERE studio_id = ? AND user_id = ?", ctx.studio.id, userId)) throw notFound("המשתמש");
  const raw = token(24);
  const now = nowIso();
  await run("INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_by, created_at) VALUES (?,?,?,?,?,?)", id("pwr"), userId, sha256(raw), addHours(now, 24), ctx.userId, now);
  await audit({ studioId: ctx.studio.id, actorId: ctx.userId, action: "user.reset_link_created", entity: "user", entityId: userId });
  return { token: raw, expires_at: addHours(now, 24) };
}

export async function resetPassword(rawToken: string, password: string) {
  const r = await one<{ id: string; user_id: string }>("SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?", sha256(rawToken), nowIso());
  if (!r) throw new AppError("blocked", "הקישור כבר שומש או שפג תוקפו.");
  const pw = validatePassword(password);
  if (pw) throw invalid({ password: pw });
  const now = nowIso();
  await tx(async () => {
    await run("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", hashPassword(password), now, r.user_id);
    await run("UPDATE password_resets SET used_at = ? WHERE id = ?", now, r.id);
    await run("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", now, r.user_id);
  });
  return { userId: r.user_id };
}

export async function changePassword(ctx: Ctx, current: string, next: string) {
  const u = (await one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", ctx.userId))!;
  if (!verifyPassword(current ?? "", u.password_hash)) throw invalid({ current: "הסיסמה הנוכחית אינה נכונה." });
  const pw = validatePassword(next);
  if (pw) throw invalid({ next: pw });
  await run("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", hashPassword(next), nowIso(), ctx.userId);
  await run("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL", nowIso(), ctx.userId, ctx.sessionId);
}

export async function updateStudioSettings(
  ctx: Ctx,
  input: { name?: string; timezone?: string; modules?: ModuleKey[]; settings?: Partial<StudioSettings> },
) {
  assertCan(ctx, "settings");
  const studio = (await getStudio(ctx.studio.id))!;
  const fields: Record<string, string> = {};
  const name = input.name !== undefined ? input.name.trim() : studio.name;
  if (!name) fields.name = "צריך שם לסטודיו.";
  const tz = input.timezone ?? studio.timezone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    fields.timezone = "אזור זמן לא מוכר.";
  }
  const modules = input.modules ? (input.modules.filter((m) => ["crm", "ai", "qr"].includes(m)) as ModuleKey[]) : [...studio.modules];
  if (!modules.includes("crm")) modules.unshift("crm");
  const settings = mergeSettings({ ...studio.settings, ...(input.settings ?? {}), rules: { ...studio.settings.rules, ...(input.settings?.rules ?? {}) } });
  const num = (v: number, min: number, max: number, key: string, msg: string) => {
    if (!Number.isFinite(v) || v < min || v > max) fields[key] = msg;
  };
  num(settings.cooldownHours, 0, 720, "cooldownHours", "בין 0 ל-720 שעות.");
  num(settings.maxContactsPer7Days, 1, 20, "maxContactsPer7Days", "בין 1 ל-20.");
  num(settings.qrRotateSeconds, 15, 600, "qrRotateSeconds", "בין 15 ל-600 שניות.");
  num(settings.checkinWindowBeforeMin, 0, 180, "checkinWindowBeforeMin", "בין 0 ל-180 דקות.");
  num(settings.checkinWindowAfterMin, 0, 180, "checkinWindowAfterMin", "בין 0 ל-180 דקות.");
  num(settings.aiMonthlyQuota, 0, 100000, "aiMonthlyQuota", "מספר לא תקין.");
  num(settings.importFreshnessHours, 1, 24 * 90, "importFreshnessHours", "מספר לא תקין.");
  if (!["he", "ar", "en"].includes(settings.messageLanguage)) fields.messageLanguage = "שפה לא נתמכת.";
  settings.studioStyle = settings.studioStyle.slice(0, 300);
  settings.signature = settings.signature.slice(0, 80);
  settings.noticeText = settings.noticeText.slice(0, 600);
  if (input.settings?.noticeText !== undefined && input.settings.noticeText !== studio.settings.noticeText) {
    const n = Number(String(studio.settings.noticeVersion).replace(/\D/g, "")) || 1;
    settings.noticeVersion = `v${n + 1}`;
  }
  if (Object.keys(fields).length) throw invalid(fields);
  await saveStudio({ id: studio.id, name, timezone: tz, locale: studio.locale, modules, settings });
  await audit({ studioId: studio.id, actorId: ctx.userId, action: "settings.updated", entity: "studio", entityId: studio.id, diff: { modules, rules: settings.rules } });
  return (await getStudio(studio.id))!;
}
