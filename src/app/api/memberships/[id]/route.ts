import { staffRoute, ok } from "@/server/http";
import { getMembership, balanceLedger, membershipLocalDates } from "@/server/services/memberships";
import { assertCan, can } from "@/server/permissions";
import { localDate } from "@/server/time";

export const GET = staffRoute((_req, ctx, { id }) => {
  assertCan(ctx, "memberships.view");
  const m = getMembership(ctx.studio.id, id);
  const tz = ctx.studio.timezone;
  return ok({
    membership: m,
    dates: membershipLocalDates(m, tz),
    pauses: m.pauses.map((p) => ({ ...p, start: localDate(p.starts_at, tz), end: localDate(new Date(Date.parse(p.ends_at) - 1), tz) })),
    ledger: balanceLedger(ctx.studio.id, id),
    permissions: { manage: can(ctx, "memberships.manage"), adjust: can(ctx, "balance.adjust") },
    today: localDate(new Date(), tz),
    tz,
  });
});
