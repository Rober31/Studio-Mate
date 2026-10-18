import { staffRoute, ok, readJson } from "@/server/http";
import { mergeContacts } from "@/server/services/contacts";
import { markEvaluationStale } from "@/server/services/followups";
import { invalid } from "@/server/errors";

// Merge another record (drop_id) into this one (id is kept).
export const POST = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<{ drop_id?: string; choose?: { display_name?: "keep" | "drop"; phone?: "keep" | "drop"; owner?: "keep" | "drop" }; reason?: string }>(req);
  if (!body.drop_id) throw invalid({ drop_id: "בחרו תיק למיזוג." });
  if (!body.reason?.trim()) throw invalid({ reason: "כתבו סיבה למיזוג." });
  const c = mergeContacts(ctx, id, body.drop_id, body.choose ?? {}, body.reason.trim());
  markEvaluationStale(ctx.studio.id);
  return ok(c);
});
