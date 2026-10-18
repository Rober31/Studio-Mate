import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth";
import { can } from "@/server/permissions";
import { allTags, listContacts, staffList, STAGES, type ContactFilters } from "@/server/services/contacts";
import { ContactsView } from "@/components/contacts/ContactsView";

export const dynamic = "force-dynamic";
export const metadata = { title: "לקוחות" };

type SP = Record<string, string | string[] | undefined>;

export default async function ContactsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "contacts.view")) redirect("/");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const view = s("view") === "board" ? "board" : "list";
  const filters: ContactFilters = {
    q: s("q"),
    stage: s("stage"),
    owner: s("owner"),
    source: s("source"),
    tag: s("tag"),
    membership: (s("membership") as ContactFilters["membership"]) || undefined,
    review: s("review") === "1",
    archived: s("archived") === "1",
    page: Number(s("page")) || 1,
    pageSize: 30,
  };
  const list = view === "list" ? listContacts(ctx, filters) : null;
  const board =
    view === "board"
      ? STAGES.map((stage) => {
          const r = listContacts(ctx, { ...filters, stage, page: 1, pageSize: 50 });
          return { stage, items: r.items, total: r.total };
        })
      : null;
  return (
    <ContactsView
      view={view}
      filters={{
        q: filters.q ?? "",
        stage: filters.stage ?? "",
        owner: filters.owner ?? "",
        source: filters.source ?? "",
        tag: filters.tag ?? "",
        membership: filters.membership ?? "",
        review: !!filters.review,
        archived: !!filters.archived,
        page: filters.page ?? 1,
      }}
      list={list ? JSON.parse(JSON.stringify(list)) : null}
      board={board ? JSON.parse(JSON.stringify(board)) : null}
      staff={staffList(ctx.studio.id)}
      tags={allTags(ctx.studio.id)}
      me={ctx.userId}
      canEdit={can(ctx, "contacts.edit")}
      canImport={can(ctx, "imports")}
      tz={ctx.studio.timezone}
      openNew={s("new") === "1"}
    />
  );
}
