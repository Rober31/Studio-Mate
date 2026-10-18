import { staffRoute, ok } from "@/server/http";
import { sessionCandidates } from "@/server/services/attendance";

export const GET = staffRoute((req, ctx, { id }) => ok(sessionCandidates(ctx, id, req.nextUrl.searchParams.get("q") ?? "")));
