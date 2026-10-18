import { staffRoute, ok } from "@/server/http";
import { markSent } from "@/server/services/drafts";

export const POST = staffRoute((_req, ctx, { id }) => ok(markSent(ctx, id)));
