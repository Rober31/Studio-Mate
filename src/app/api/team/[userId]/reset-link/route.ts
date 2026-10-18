import { staffRoute, ok } from "@/server/http";
import { createResetLink } from "@/server/services/team";

export const POST = staffRoute((_req, ctx, { userId }) => ok(createResetLink(ctx, userId), undefined, 201));
