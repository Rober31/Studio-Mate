import { staffRoute, ok } from "@/server/http";
import { importReport } from "@/server/services/imports";

export const GET = staffRoute(async (_req, ctx, { id }) => ok(await importReport(ctx, id)));
