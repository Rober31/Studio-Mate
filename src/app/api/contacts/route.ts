import { staffRoute, ok, readJson } from "@/server/http";
import { createContact, listContacts, type ContactFilters, type ContactInput } from "@/server/services/contacts";
import { markEvaluationStale } from "@/server/services/followups";

export const GET = staffRoute((req, ctx) => {
  const sp = req.nextUrl.searchParams;
  const f: ContactFilters = {
    q: sp.get("q") || undefined,
    stage: sp.get("stage") || undefined,
    owner: sp.get("owner") || undefined,
    source: sp.get("source") || undefined,
    tag: sp.get("tag") || undefined,
    membership: (sp.get("membership") as ContactFilters["membership"]) || undefined,
    review: sp.get("review") === "1",
    archived: sp.get("archived") === "1",
    page: Number(sp.get("page")) || 1,
    pageSize: Number(sp.get("pageSize")) || 30,
  };
  const r = listContacts(ctx, f);
  return ok(r.items, { total: r.total, page: r.page, pageSize: r.pageSize });
});

export const POST = staffRoute(async (req, ctx) => {
  const body = await readJson<ContactInput>(req);
  const c = createContact(ctx, body);
  markEvaluationStale(ctx.studio.id);
  return ok(c, undefined, 201);
});
