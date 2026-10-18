import { staffRoute, ok } from "@/server/http";
import { listRegistrations } from "@/server/services/public";

export const GET = staffRoute((req, ctx) => ok(listRegistrations(ctx, req.nextUrl.searchParams.get("status") === "all" ? "all" : "new")));
