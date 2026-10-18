import { notFound, redirect } from "next/navigation";
import { requireCtx } from "@/server/auth";
import { can, hasModule } from "@/server/permissions";
import { AppError } from "@/server/errors";
import { contactTimeline, getContact, listNotes, staffList } from "@/server/services/contacts";
import { membershipsForContact, membershipLocalDates } from "@/server/services/memberships";
import { attendanceForContact } from "@/server/services/attendance";
import { tasksForContact } from "@/server/services/tasks";
import { draftsForContact } from "@/server/services/drafts";
import { contactGuards, suggestionsForContact } from "@/server/services/followups";
import { memberDevices } from "@/server/services/public";
import { parseJson } from "@/server/util";
import { ContactProfile } from "@/components/contacts/ContactProfile";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  try {
    return { title: (await getContact(ctx, id)).display_name };
  } catch {
    return { title: "לקוח" };
  }
}

export default async function ContactPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "contacts.view")) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  let contact;
  try {
    contact = await getContact(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  if (contact.merged_into) redirect(`/contacts/${contact.merged_into}`);
  const tz = ctx.studio.timezone;
  // Independent reads run in parallel (each is a network round trip in production).
  const [membershipRows, suggestionRows, notes, timeline, attendance, tasks, drafts, guards, devices, staff] = await Promise.all([
    can(ctx, "memberships.view") ? membershipsForContact(ctx.studio.id, id) : Promise.resolve([]),
    suggestionsForContact(ctx, id),
    listNotes(ctx, id),
    contactTimeline(ctx, id),
    attendanceForContact(ctx.studio.id, id),
    tasksForContact(ctx, id),
    can(ctx, "followup.use") ? draftsForContact(ctx, id) : Promise.resolve([]),
    contactGuards(ctx.studio, id),
    hasModule(ctx, "qr") ? memberDevices(ctx, id) : Promise.resolve([]),
    staffList(ctx.studio.id),
  ]);
  const memberships = membershipRows.map((m) => ({ ...m, ...membershipLocalDates(m, tz) }));
  const suggestions = suggestionRows.map((s) => ({ ...s, facts: parseJson<Record<string, unknown>>(s.facts, {}) }));
  const data = { contact, notes, timeline, memberships, attendance, tasks, drafts, suggestions, guards, devices };
  return (
    <ContactProfile
      key={`${contact.id}:${contact.version}`}
      data={JSON.parse(JSON.stringify(data))}
      staff={staff}
      tz={tz}
      perms={{
        edit: can(ctx, "contacts.edit"),
        merge: can(ctx, "contacts.merge"),
        followup: can(ctx, "followup.use"),
        membershipsView: can(ctx, "memberships.view"),
        membershipsManage: can(ctx, "memberships.manage"),
        qr: hasModule(ctx, "qr") && can(ctx, "attendance.record"),
      }}
      initialTab={sp.tab}
      openEdit={sp.edit === "1"}
    />
  );
}
