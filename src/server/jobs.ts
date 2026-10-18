import { all, run } from "./db";
import { getStudio } from "./studio";
import { evaluateStudio } from "./services/followups";
import { addDays, nowIso } from "./util";

const g = globalThis as unknown as { __smJobs?: boolean };

/** Rule evaluation for every studio and cleanup of expired tokens (spec §31). */
export async function runJobsOnce() {
  const studios = await all<{ id: string }>("SELECT id FROM studios WHERE status = 'active'");
  for (const s of studios) {
    const studio = await getStudio(s.id);
    if (!studio) continue;
    try {
      await evaluateStudio(studio);
    } catch (e) {
      console.error(`[jobs] rule evaluation failed for ${s.id}`, e);
    }
  }
  const now = nowIso();
  await run("DELETE FROM qr_challenges WHERE expires_at < ?", addDays(now, -1));
  await run("UPDATE member_activations SET revoked_at = ? WHERE expires_at < ? AND used_at IS NULL AND revoked_at IS NULL", now, now);
  await run("DELETE FROM auth_sessions WHERE expires_at < ?", addDays(now, -30));
  await run("DELETE FROM idempotency_keys WHERE created_at < ?", addDays(now, -7));
  return { studios: studios.length };
}

/** Self-hosted servers run jobs in-process; on Vercel they run from Vercel Cron (/api/cron/jobs). */
export function startJobs() {
  if (g.__smJobs) return;
  g.__smJobs = true;
  setTimeout(() => runJobsOnce().catch((e) => console.error("[jobs]", e)), 10_000);
  setInterval(() => runJobsOnce().catch((e) => console.error("[jobs]", e)), 15 * 60_000).unref?.();
}
