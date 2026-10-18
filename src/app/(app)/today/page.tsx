import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth";
import { can } from "@/server/permissions";
import { todayList } from "@/server/services/followups";
import { staffList } from "@/server/services/contacts";
import { TodayView } from "@/components/followup/TodayView";

export const dynamic = "force-dynamic";
export const metadata = { title: "היום" };

export default async function TodayPage() {
  const ctx = await requireCtx();
  if (!can(ctx, "contacts.view")) redirect("/");
  const [data, staff] = await Promise.all([todayList(ctx), staffList(ctx.studio.id)]);
  return (
    <TodayView
      initial={JSON.parse(JSON.stringify(data))}
      staff={staff}
      me={{ id: ctx.userId, name: ctx.name }}
      tz={ctx.studio.timezone}
      canFollowup={can(ctx, "followup.use")}
      canSettings={can(ctx, "settings")}
    />
  );
}
