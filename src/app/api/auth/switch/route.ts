import { staffRoute, ok, readJson } from "@/server/http";
import { createSession, destroySession, userStudios } from "@/server/auth";
import { AppError } from "@/server/errors";

export const POST = staffRoute(async (req, ctx) => {
  const { studio_id } = await readJson<{ studio_id?: string }>(req);
  const allowed = userStudios(ctx.userId).some((s) => s.id === studio_id);
  if (!allowed || !studio_id) throw new AppError("forbidden", "אין לך גישה לסטודיו הזה.");
  await destroySession();
  await createSession(ctx.userId, studio_id);
  return ok({ ok: true });
});
