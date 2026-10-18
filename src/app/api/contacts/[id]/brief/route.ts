import { staffRoute, ok } from "@/server/http";
import { getContact } from "@/server/services/contacts";
import { membershipsForContact } from "@/server/services/memberships";
import { tasksForContact } from "@/server/services/tasks";
import { contactGuards } from "@/server/services/followups";
import { all } from "@/server/db";

// Context shown before preparing a new message: recent actions, open tasks, membership (FUP-03).
export const GET = staffRoute(async (_req, ctx, { id }) => {
  const contact = await getContact(ctx, id);
  const [allMemberships, allTasks] = await Promise.all([membershipsForContact(ctx.studio.id, id), tasksForContact(ctx, id)]);
  const memberships = allMemberships.filter((m) => m.status !== "cancelled").slice(0, 3);
  const tasks = allTasks.filter((t) => ["open", "in_progress", "snoozed"].includes(t.status));
  const recent = await all<{ occurred_at: string; event_type: string; outcome: string | null; note: string | null; channel: string; actor: string | null }>(
    `SELECT e.occurred_at, e.event_type, e.outcome, e.note, e.channel, u.name AS actor FROM interaction_events e LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.contact_id = ? AND e.studio_id = ? AND e.event_type IN ('wa_opened','marked_sent','outcome_recorded','call','renewal','registration')
      ORDER BY e.occurred_at DESC LIMIT 5`,
    id,
    ctx.studio.id,
  );
  return ok({ contact, memberships, tasks, recent, guards: await contactGuards(ctx.studio, id) });
});
