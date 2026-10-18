import { staffRoute, ok, readJson } from "@/server/http";
import { addNote, listNotes } from "@/server/services/contacts";

export const GET = staffRoute((_req, ctx, { id }) => ok(listNotes(ctx, id)));

export const POST = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<{ body?: string; is_private?: boolean }>(req);
  addNote(ctx, id, body.body ?? "", !!body.is_private);
  return ok(listNotes(ctx, id), undefined, 201);
});
