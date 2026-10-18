import { staffRoute, ok, readJson } from "@/server/http";
import { getTask, updateTask, type TaskPatch } from "@/server/services/tasks";
import { markEvaluationStale } from "@/server/services/followups";

export const GET = staffRoute(async (_req, ctx, { id }) => ok(await getTask(ctx, id)));

export const PATCH = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<TaskPatch>(req);
  const t = await updateTask(ctx, id, body);
  await markEvaluationStale(ctx.studio.id);
  return ok(t);
});
