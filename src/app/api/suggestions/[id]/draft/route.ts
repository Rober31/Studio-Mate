import { staffRoute, ok, readJson } from "@/server/http";
import { prepareDraft } from "@/server/services/drafts";
import { getSuggestion } from "@/server/services/followups";
import { rateLimit } from "@/server/ratelimit";
import { AppError } from "@/server/errors";
import type { Lang, Tone } from "@/server/services/ai";

export const POST = staffRoute(async (req, ctx, { id }) => {
  if (!rateLimit(`draft:${ctx.userId}`, 40, 10 * 60_000)) throw new AppError("rate_limited", "יותר מדי בקשות. חכו רגע ונסו שוב.");
  const body = await readJson<{ language?: Lang; tone?: Tone; length?: "short" | "normal"; override_reason?: string }>(req);
  const s = await getSuggestion(ctx, id);
  const draft = await prepareDraft(ctx, { contact_id: s.contact_id, suggestion_id: id, ...body });
  return ok(draft, undefined, 201);
});
