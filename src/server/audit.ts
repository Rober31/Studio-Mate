import { run } from "./db";
import { id, nowIso } from "./util";

export function audit(params: {
  studioId: string | null;
  actorId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  reason?: string | null;
  diff?: unknown;
}) {
  run(
    "INSERT INTO audit_events (id, studio_id, actor_id, action, entity, entity_id, reason, diff, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    id("aud"),
    params.studioId,
    params.actorId,
    params.action,
    params.entity,
    params.entityId ?? null,
    params.reason ?? null,
    params.diff === undefined ? null : JSON.stringify(params.diff),
    nowIso(),
  );
}
