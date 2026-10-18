import { staffRoute, ok } from "@/server/http";
import { listContacts } from "@/server/services/contacts";

// Lightweight contact picker for task / membership sheets.
export const GET = staffRoute((req, ctx) => {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const res = listContacts(ctx, { q, pageSize: 12 });
  return ok(res.items.map((c) => ({ id: c.id, display_name: c.display_name, phone_e164: c.phone_e164, pipeline_stage: c.pipeline_stage, owner_id: c.owner_id })));
});
