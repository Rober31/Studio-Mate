import { staffRoute, ok, readJson } from "@/server/http";
import { prepareDraft } from "@/server/services/drafts";
import { rateLimit } from "@/server/ratelimit";
import { AppError, invalid } from "@/server/errors";
import type { Lang, Tone } from "@/server/services/ai";

// Draft for a manual task or a general follow-up (no rule suggestion).
export const POST = staffRoute(async (req, ctx) => {
  if (!rateLimit(`draft:${ctx.userId}`, 40, 10 * 60_000)) throw new AppError("rate_limited", "יותר מדי בקשות. חכו רגע ונסו שוב.");
  const body = await readJson<{ contact_id?: string; suggestion_id?: string; task_id?: string; language?: Lang; tone?: Tone; length?: "short" | "normal"; override_reason?: string }>(req);
  if (!body.contact_id) throw invalid({ contact_id: "בחרו לקוח." });
  const draft = await prepareDraft(ctx, { ...body, contact_id: body.contact_id });
  return ok(draft, undefined, 201);
});
