import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { one, run, all } from "./db";
import { addDays, id, nowIso, sha256, token, verifyPassword, hashPassword } from "./util";
import { toStudio, type StudioRow } from "./studio";
import type { Ctx, Role } from "./permissions";
import { AppError } from "./errors";
import { audit } from "./audit";

export const SESSION_COOKIE = "sm_session";
const SESSION_DAYS = 14;

type SessionRow = {
  session_id: string;
  user_id: string;
  expires_at: string;
  last_seen_at: string;
  user_name: string;
  email: string;
  role: Role;
  scope: "all" | "assigned";
};

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

export async function loadSession(rawToken: string | undefined): Promise<Ctx | null> {
  if (!rawToken) return null;
  // One round trip: session, user, membership and studio together.
  const row = await one<SessionRow & StudioRow & { session_studio_id: string }>(
    `SELECT s.id AS session_id, s.user_id, s.studio_id AS session_studio_id, s.expires_at, s.last_seen_at, u.name AS user_name, u.email, m.role, m.scope,
            st.id, st.name, st.slug, st.timezone, st.locale, st.default_country, st.enabled_modules, st.settings, st.status
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN staff_memberships m ON m.user_id = s.user_id AND m.studio_id = s.studio_id AND m.active = 1
       JOIN studios st ON st.id = s.studio_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    sha256(rawToken),
    nowIso(),
  );
  if (!row || row.status !== "active") return null;
  // Touch at most once every 5 minutes.
  if (Date.now() - Date.parse(row.last_seen_at) > 5 * 60_000) {
    await run("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?", nowIso(), row.session_id);
  }
  return {
    userId: row.user_id,
    name: row.user_name,
    email: row.email,
    role: row.role,
    scope: row.scope,
    studio: toStudio(row),
    sessionId: row.session_id,
  };
}

export async function getCtx(): Promise<Ctx | null> {
  const jar = await cookies();
  return await loadSession(jar.get(SESSION_COOKIE)?.value);
}

/** For server components: returns the context or redirects to the login screen. */
export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  return ctx;
}

export async function createSession(userId: string, studioId: string): Promise<void> {
  const raw = token();
  const expires = new Date(addDays(new Date(), SESSION_DAYS));
  const h = await headers();
  await run(
    "INSERT INTO auth_sessions (id, token_hash, user_id, studio_id, expires_at, user_agent, created_at, last_seen_at) VALUES (?,?,?,?,?,?,?,?)",
    id("ses"),
    sha256(raw),
    userId,
    studioId,
    expires.toISOString(),
    (h.get("user-agent") ?? "").slice(0, 200),
    nowIso(),
    nowIso(),
  );
  const jar = await cookies();
  jar.set(SESSION_COOKIE, raw, cookieOptions(expires));
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (raw) await run("UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?", nowIso(), sha256(raw));
  jar.delete(SESSION_COOKIE);
}

export async function revokeUserSessions(userId: string, studioId: string) {
  await run("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND studio_id = ? AND revoked_at IS NULL", nowIso(), userId, studioId);
}

export async function authenticate(email: string, password: string): Promise<{ userId: string; studioId: string }> {
  const user = await one<{ id: string; password_hash: string }>("SELECT id, password_hash FROM users WHERE email = ?", email.trim());
  // Constant-ish work even when the user does not exist.
  const ok = user ? verifyPassword(password, user.password_hash) : (verifyPassword(password, hashPassword("x")), false);
  if (!user || !ok) throw new AppError("unauthenticated", "האימייל או הסיסמה אינם נכונים.");
  const memberships = await all<{ studio_id: string }>(
    "SELECT m.studio_id FROM staff_memberships m JOIN studios s ON s.id = m.studio_id WHERE m.user_id = ? AND m.active = 1 AND s.status = 'active' ORDER BY m.created_at",
    user.id,
  );
  if (!memberships.length) throw new AppError("forbidden", "החשבון אינו פעיל באף סטודיו. פנו לבעלי הסטודיו.");
  await audit({ studioId: memberships[0].studio_id, actorId: user.id, action: "auth.login", entity: "user", entityId: user.id });
  return { userId: user.id, studioId: memberships[0].studio_id };
}

export async function userStudios(userId: string) {
  return await all<{ id: string; name: string; role: Role }>(
    "SELECT s.id, s.name, m.role FROM staff_memberships m JOIN studios s ON s.id = m.studio_id WHERE m.user_id = ? AND m.active = 1 AND s.status = 'active' ORDER BY s.name",
    userId,
  );
}
