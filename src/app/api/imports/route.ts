import { staffRoute, ok } from "@/server/http";
import { listImports } from "@/server/services/imports";

export const GET = staffRoute(async (_req, ctx) => ok(await listImports(ctx)));
