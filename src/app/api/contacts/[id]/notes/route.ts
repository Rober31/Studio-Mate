import { staffRoute, ok, readJson } from "@/server/http";
import { addNote, listNotes } from "@/server/services/contacts";

export const GET = staffRoute(async (_req, ctx, { id }) => ok(await listNotes(ctx, id)));

export const POST = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<{ body?: string; is_private?: boolean }>(req);
  await addNote(ctx, id, body.body ?? "", !!body.is_private);
  return ok(await listNotes(ctx, id), undefined, 201);
});
