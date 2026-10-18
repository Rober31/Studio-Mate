import { staffRoute, ok } from "@/server/http";
import { importReport } from "@/server/services/imports";

export const GET = staffRoute((_req, ctx, { id }) => ok(importReport(ctx, id)));
