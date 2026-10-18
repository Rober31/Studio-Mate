import { staffRoute, ok, readJson } from "@/server/http";
import { snoozeSuggestion } from "@/server/services/followups";

export const POST = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<{ until?: string; reason?: string }>(req);
  await snoozeSuggestion(ctx, id, body.until ?? "", body.reason);
  return ok({ ok: true });
});
