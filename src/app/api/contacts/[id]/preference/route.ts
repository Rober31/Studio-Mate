import { staffRoute, ok, readJson } from "@/server/http";
import { getContact, setContactPreference } from "@/server/services/contacts";
import { markEvaluationStale } from "@/server/services/followups";
import { invalid } from "@/server/errors";

export const POST = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<{ allowed?: boolean; reason?: string }>(req);
  if (typeof body.allowed !== "boolean") throw invalid({ allowed: "חסרה בחירה." });
  if (!body.allowed && !body.reason?.trim()) throw invalid({ reason: "כתבו סיבה לחסימת הקשר." });
  await setContactPreference(ctx, id, body.allowed, body.reason?.trim() || null);
  await markEvaluationStale(ctx.studio.id);
  return ok(await getContact(ctx, id));
});
