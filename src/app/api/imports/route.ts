import { staffRoute, ok } from "@/server/http";
import { listImports } from "@/server/services/imports";

export const GET = staffRoute((_req, ctx) => ok(listImports(ctx)));
