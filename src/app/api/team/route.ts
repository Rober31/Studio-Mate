import { staffRoute, ok } from "@/server/http";
import { listTeam } from "@/server/services/team";

export const GET = staffRoute((_req, ctx) => ok(listTeam(ctx)));
