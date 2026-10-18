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
  const list = listMemberships(ctx, { status: "active" });
  return (
    <MembershipsView
      initialTab={sp.tab === "plans" ? "plans" : "memberships"}
      initial={JSON.parse(JSON.stringify(list))}
      plans={listPlans(ctx.studio.id, true)}
      tz={ctx.studio.timezone}
      canManage={can(ctx, "memberships.manage")}
    />
  );
}
