import { staffRoute, ok } from "@/server/http";
import { markSent } from "@/server/services/drafts";

export const POST = staffRoute(async (_req, ctx, { id }) => ok(await markSent(ctx, id)));
