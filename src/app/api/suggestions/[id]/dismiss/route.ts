import { staffRoute, ok, readJson } from "@/server/http";
import { dismissSuggestion } from "@/server/services/followups";

export const POST = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<{ reason?: string }>(req);
  await dismissSuggestion(ctx, id, body.reason ?? "");
  return ok({ ok: true });
});
