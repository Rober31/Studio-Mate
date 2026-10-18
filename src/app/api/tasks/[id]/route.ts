import { staffRoute, ok, readJson } from "@/server/http";
import { getTask, updateTask, type TaskPatch } from "@/server/services/tasks";
import { markEvaluationStale } from "@/server/services/followups";

export const GET = staffRoute((_req, ctx, { id }) => ok(getTask(ctx, id)));

export const PATCH = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<TaskPatch>(req);
  const t = updateTask(ctx, id, body);
  markEvaluationStale(ctx.studio.id);
  return ok(t);
});
