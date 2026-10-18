import { notFound, redirect } from "next/navigation";
import { requireCtx } from "@/server/auth";
import { can, hasModule } from "@/server/permissions";
import { getSession, roster, checkinWindow } from "@/server/services/attendance";
import { staffList } from "@/server/services/contacts";
import { SessionDetail } from "@/components/sessions/SessionDetail";

export const dynamic = "force-dynamic";
export const metadata = { title: "שיעור" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  if (!hasModule(ctx, "qr") || !can(ctx, "attendance.record")) redirect("/");
  const { id } = await params;
  let session;
  try {
    session = await getSession(ctx, id);
  } catch {
    notFound();
  }
  return (
    <SessionDetail
      initial={JSON.parse(JSON.stringify({ session, roster: await roster(ctx, id) }))}
      window={checkinWindow(ctx.studio, session)}
      tz={ctx.studio.timezone}
      staff={await staffList(ctx.studio.id)}
      perms={{
        manage: can(ctx, "sessions.manage"),
        correct: can(ctx, "attendance.correct"),
        export: can(ctx, "export") || can(ctx, "attendance.correct"),
        contacts: can(ctx, "contacts.view"),
      }}
    />
  );
}
