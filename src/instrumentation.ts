// Lightweight scheduled jobs for a single-server deployment (spec §31):
// periodic rule evaluation per studio and cleanup of expired tokens.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.STUDIOMATE_DISABLE_JOBS === "1") return;
  const { startJobs } = await import("./server/jobs");
  startJobs();
}
