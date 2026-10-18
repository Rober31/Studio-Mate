import { staffRoute, ok } from "@/server/http";
import { rollbackImport } from "@/server/services/imports";

export const POST = staffRoute(async (_req, ctx, { id }) => ok(await rollbackImport(ctx, id)));
