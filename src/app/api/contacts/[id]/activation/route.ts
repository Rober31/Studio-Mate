import { staffRoute, ok } from "@/server/http";
import { createActivation } from "@/server/services/public";

export const POST = staffRoute((_req, ctx, { id }) => ok(createActivation(ctx, id), undefined, 201));
