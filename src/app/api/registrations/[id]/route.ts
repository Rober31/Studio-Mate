import { staffRoute, ok, readJson } from "@/server/http";
import { reviewRegistration } from "@/server/services/public";
import { invalid } from "@/server/errors";

export const PATCH = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<{ status?: "reviewed" | "rejected"; owner_id?: string | null }>(req);
  if (body.status !== undefined && body.status !== "reviewed" && body.status !== "rejected") throw invalid({ status: "החלטה לא מוכרת." });
  await reviewRegistration(ctx, id, body.status ?? null, body.owner_id);
  return ok({ ok: true });
});
