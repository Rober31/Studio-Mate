import { staffRoute, ok } from "@/server/http";
import { createResetLink } from "@/server/services/team";

export const POST = staffRoute(async (_req, ctx, { userId }) => ok(await createResetLink(ctx, userId), undefined, 201));
