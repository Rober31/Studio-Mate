import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth";
import { can } from "@/server/permissions";
import { listRegistrations } from "@/server/services/public";
import { staffList } from "@/server/services/contacts";
import { RegistrationsView } from "@/components/sessions/RegistrationsView";

export const dynamic = "force-dynamic";
export const metadata = { title: "בקשות הרשמה" };

export default async function RegistrationsPage() {
  const ctx = await requireCtx();
  if (!can(ctx, "registrations.review")) redirect("/");
  return (
    <RegistrationsView
      items={JSON.parse(JSON.stringify(listRegistrations(ctx, "all")))}
      staff={staffList(ctx.studio.id)}
      slug={ctx.studio.slug}
      studioName={ctx.studio.name}
      tz={ctx.studio.timezone}
      canOpenContact={can(ctx, "contacts.view")}
    />
  );
}
