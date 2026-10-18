import { staffRoute, ok } from "@/server/http";
import { createActivation } from "@/server/services/public";

export const POST = staffRoute(async (_req, ctx, { id }) => ok(await createActivation(ctx, id), undefined, 201));
