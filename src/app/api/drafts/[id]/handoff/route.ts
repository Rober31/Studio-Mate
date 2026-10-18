import { staffRoute, ok, readJson } from "@/server/http";
import { handoff } from "@/server/services/drafts";

export const POST = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<{ text?: string }>(req);
  return ok(await handoff(ctx, id, body.text));
});
