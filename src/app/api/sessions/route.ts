import { staffRoute, ok, readJson } from "@/server/http";
import { listSessions, saveSession } from "@/server/services/attendance";
import { invalid } from "@/server/errors";

export const GET = staffRoute((req, ctx) => {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw invalid({ from: "טווח תאריכים לא תקין." });
  return ok(listSessions(ctx, new Date(from).toISOString(), new Date(to).toISOString()));
});

export const POST = staffRoute(async (req, ctx) => {
  const body = await readJson<{ title?: string; date?: string; start?: string; end?: string; trainer_id?: string | null; repeat_weeks?: number }>(req);
  return ok(saveSession(ctx, body), undefined, 201);
});
