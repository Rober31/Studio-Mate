import { staffRoute, ok, readJson } from "@/server/http";
import { editDraft, getDraft } from "@/server/services/drafts";

export const GET = staffRoute((_req, ctx, { id }) => ok(getDraft(ctx, id)));

export const PATCH = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<{ text?: string; version?: number }>(req);
  return ok(editDraft(ctx, id, body.text ?? "", Number(body.version)));
});
