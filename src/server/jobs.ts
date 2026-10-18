import { all, run } from "./db";
import { getStudio } from "./studio";
import { evaluateStudio } from "./services/followups";
import { addDays, nowIso } from "./util";

const g = globalThis as unknown as { __smJobs?: boolean };

export function runJobsOnce() {
  for (const s of all<{ id: string }>("SELECT id FROM studios WHERE status = 'active'")) {
    const studio = getStudio(s.id);
    if (!studio) continue;
    try {
      evaluateStudio(studio);
    } catch (e) {
      console.error(`[jobs] rule evaluation failed for ${s.id}`, e);
    }
  }
  const now = nowIso();
  run("DELETE FROM qr_challenges WHERE expires_at < ?", addDays(now, -1));
  run("UPDATE member_activations SET revoked_at = ? WHERE expires_at < ? AND used_at IS NULL AND revoked_at IS NULL", now, now);
  run("DELETE FROM auth_sessions WHERE expires_at < ?", addDays(now, -30));
  run("DELETE FROM idempotency_keys WHERE created_at < ?", addDays(now, -7));
}

export function startJobs() {
  if (g.__smJobs) return;
  g.__smJobs = true;
  setTimeout(() => runJobsOnce(), 10_000);
  setInterval(() => runJobsOnce(), 15 * 60_000).unref?.();
}
