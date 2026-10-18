import { staffRoute, ok, readJson } from "@/server/http";
import { getContact, updateContact, type ContactPatch } from "@/server/services/contacts";
import { markEvaluationStale } from "@/server/services/followups";

export const GET = staffRoute(async (_req, ctx, { id }) => ok(await getContact(ctx, id)));

export const PATCH = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<ContactPatch>(req);
  const c = await updateContact(ctx, id, body);
  await markEvaluationStale(ctx.studio.id);
  return ok(c);
});
