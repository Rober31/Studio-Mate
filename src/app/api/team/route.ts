import { staffRoute, ok } from "@/server/http";
import { listTeam } from "@/server/services/team";

export const GET = staffRoute(async (_req, ctx) => ok(await listTeam(ctx)));
