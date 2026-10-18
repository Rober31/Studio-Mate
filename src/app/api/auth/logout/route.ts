import { publicRoute, ok } from "@/server/http";
import { destroySession } from "@/server/auth";

export const POST = publicRoute(async () => {
  await destroySession();
  return ok({ ok: true });
});
