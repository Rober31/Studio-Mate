import { staffRoute, ok } from "@/server/http";
import { rollbackImport } from "@/server/services/imports";

export const POST = staffRoute((_req, ctx, { id }) => ok(rollbackImport(ctx, id)));
