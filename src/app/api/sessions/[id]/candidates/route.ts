import { staffRoute, ok } from "@/server/http";
import { sessionCandidates } from "@/server/services/attendance";

export const GET = staffRoute(async (req, ctx, { id }) => ok(await sessionCandidates(ctx, id, req.nextUrl.searchParams.get("q") ?? "")));
