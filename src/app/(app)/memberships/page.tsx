import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth";
import { can } from "@/server/permissions";
import { listMemberships, listPlans } from "@/server/services/memberships";
import { MembershipsView } from "@/components/memberships/MembershipsView";

export const dynamic = "force-dynamic";
export const metadata = { title: "מנויים" };

export default async function MembershipsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "memberships.view")) redirect("/");
  const sp = await searchParams;
  const [list, plans] = await Promise.all([listMemberships(ctx, { status: "active" }), listPlans(ctx.studio.id, true)]);
  return (
    <MembershipsView
      initialTab={sp.tab === "plans" ? "plans" : "memberships"}
      initial={JSON.parse(JSON.stringify(list))}
      plans={plans}
      tz={ctx.studio.timezone}
      canManage={can(ctx, "memberships.manage")}
    />
  );
}
