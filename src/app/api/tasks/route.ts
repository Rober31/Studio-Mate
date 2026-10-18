import { staffRoute, ok, readJson } from "@/server/http";
import { createTask, listTasks, taskCounts } from "@/server/services/tasks";

export const GET = staffRoute((req, ctx) => {
  const sp = req.nextUrl.searchParams;
  const view = (sp.get("view") as "today" | "overdue" | "snoozed" | "upcoming" | "done") || "today";
  return ok({ items: listTasks(ctx, view, sp.get("mine") === "1"), counts: taskCounts(ctx) });
});

export const POST = staffRoute(async (req, ctx) => {
  const body = await readJson<{ contact_id?: string; title?: string; due_at?: string; assignee_id?: string | null; reason?: string }>(req);
  return ok(createTask(ctx, body), undefined, 201);
});
