import { notFound, redirect } from "next/navigation";
import { requireCtx } from "@/server/auth";
import { can, hasModule } from "@/server/permissions";
import { getSession } from "@/server/services/attendance";
import { QrDisplay } from "@/components/sessions/QrDisplay";

export const dynamic = "force-dynamic";
export const metadata = { title: "QR לנוכחות" };

// Full-screen display for a tablet / screen at the studio entrance (no app chrome).
export default async function DisplayPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  if (!hasModule(ctx, "qr") || !can(ctx, "attendance.record")) redirect("/");
  const { id } = await params;
  let session;
  try {
    session = getSession(ctx, id);
  } catch {
    notFound();
  }
  return <QrDisplay sessionId={session.id} studioName={ctx.studio.name} tz={ctx.studio.timezone} initialTitle={session.title} initialStart={session.start_at} />;
}
