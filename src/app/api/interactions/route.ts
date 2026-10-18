import { staffRoute, ok, readJson } from "@/server/http";
import { recordOutcome, type Outcome } from "@/server/services/tasks";
import { invalid } from "@/server/errors";
import { markEvaluationStale } from "@/server/services/followups";

export const POST = staffRoute(async (req, ctx) => {
  const body = await readJson<{
    contact_id?: string;
    outcome?: Outcome;
    note?: string;
    channel?: string;
    suggestion_id?: string;
    draft_id?: string;
    task_id?: string;
    task_version?: number;
    follow_up?: { due_at: string; title?: string } | null;
    renewal_reference?: string;
    membership_id?: string;
    lost_reason?: string;
  }>(req);
  if (!body.contact_id) throw invalid({ contact_id: "חסר לקוח." });
  recordOutcome(ctx, { ...body, contact_id: body.contact_id });
  markEvaluationStale(ctx.studio.id);
  return ok({ ok: true }, undefined, 201);
});
