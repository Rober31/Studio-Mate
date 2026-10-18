import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth";
import { can } from "@/server/permissions";
import { listTasks, taskCounts } from "@/server/services/tasks";
import { staffList } from "@/server/services/contacts";
import { TasksView } from "@/components/tasks/TasksView";

export const dynamic = "force-dynamic";
export const metadata = { title: "משימות" };

export default async function TasksPage() {
  const ctx = await requireCtx();
  if (!can(ctx, "contacts.view")) redirect("/");
  const counts = taskCounts(ctx);
  const view = counts.overdue > 0 && counts.today === 0 ? "overdue" : "today";
  return (
    <TasksView
      initialView={view}
      initial={JSON.parse(JSON.stringify({ items: listTasks(ctx, view, false), counts }))}
      staff={staffList(ctx.studio.id)}
      me={{ id: ctx.userId, name: ctx.name }}
      tz={ctx.studio.timezone}
      canFollowup={can(ctx, "followup.use")}
    />
  );
}
