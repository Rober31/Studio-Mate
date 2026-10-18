"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SOURCE_LABEL, STAGE_LABEL, STAGE_ORDER, STAGE_TONE } from "@/lib/i18n";
import { fmtPhone, relTime } from "@/lib/format";
import { Icon } from "../Icon";
import { Avatar, Badge, Button, EmptyState, SearchInput, Segmented, cx } from "../ui";
import { NewContactSheet } from "./NewContactSheet";
import "@/app/contacts.css";

export type ContactItem = {
  id: string;
  display_name: string;
  phone_e164: string | null;
  phone_valid: number;
  pipeline_stage: string;
  owner_name: string | null;
  source: string;
  tags: string[];
  needs_review: number;
  contact_allowed: boolean;
  updated_at: string;
  archived: number;
};

type Filters = {
  q: string;
  stage: string;
  owner: string;
  source: string;
  tag: string;
  membership: string;
  review: boolean;
  archived: boolean;
  page: number;
};

export function ContactsView({
  view,
  filters,
  list,
  board,
  staff,
  tags,
  me,
  canEdit,
  canImport,
  openNew,
}: {
  view: "list" | "board";
  filters: Filters;
  list: { items: ContactItem[]; total: number; page: number; pageSize: number } | null;
  board: { stage: string; items: ContactItem[]; total: number }[] | null;
  staff: { id: string; name: string }[];
  tags: string[];
  me: string;
  canEdit: boolean;
  canImport: boolean;
  tz: string;
  openNew: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(filters.q);
  const [newOpen, setNewOpen] = useState(false);
  // Open after hydration: sheets render through a client-only portal.
  useEffect(() => {
    if (openNew) setNewOpen(true);
  }, [openNew]);
  const first = useRef(true);

  const push = (patch: Partial<Filters> & { view?: string }) => {
    const next: Record<string, string> = {};
    const merged = { ...filters, view, ...patch } as Record<string, unknown>;
    if (!("page" in patch)) merged.page = 1;
    for (const [k, val] of Object.entries(merged)) {
      if (val === "" || val === false || val === undefined || val === null) continue;
      if (k === "page" && val === 1) continue;
      if (k === "view" && val === "list") continue;
      next[k] = val === true ? "1" : String(val);
    }
    const qs = new URLSearchParams(next).toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  // Debounced, URL-synced search.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => push({ q }), 280);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const activeFilters = [filters.stage, filters.owner, filters.source, filters.tag, filters.membership, filters.review, filters.archived].filter(Boolean).length;
  const total = view === "list" ? list?.total ?? 0 : (board ?? []).reduce((s, c) => s + c.total, 0);

  const closeNew = () => {
    setNewOpen(false);
    if (openNew) {
      const sp = new URLSearchParams(window.location.search);
      sp.delete("new");
      router.replace(sp.toString() ? `${pathname}?${sp}` : pathname, { scroll: false });
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">לקוחות</h1>
          <p className="page-sub num">{total.toLocaleString("he-IL")} תיקים{activeFilters ? " לפי הסינון" : ""}</p>
        </div>
        <div className="row">
          {canImport && (
            <Link href="/imports" className="btn ghost hide-mobile">
              <Icon name="upload" size={18} /> ייבוא
            </Link>
          )}
          {canEdit && (
            <Button variant="primary" icon="plus" onClick={() => setNewOpen(true)}>
              <span className="hide-mobile">לקוח חדש</span>
              <span className="hide-desktop">חדש</span>
            </Button>
          )}
        </div>
      </div>

      <div className="row wrap" style={{ marginBottom: 12, gap: 10 }}>
        <div className="grow" style={{ minWidth: 220 }}>
          <SearchInput value={q} onChange={setQ} placeholder="חיפוש לפי שם או טלפון" />
        </div>
        <Segmented
          label="תצוגה"
          value={view}
          onChange={(v) => push({ view: v })}
          options={[
            { value: "list", label: "רשימה" },
            { value: "board", label: "שלבים" },
          ]}
        />
      </div>

      <div className="chips contacts-filters" style={{ marginBottom: 16 }} role="group" aria-label="סינון">
        {view === "list" && (
          <FilterSelect
            icon="layers"
            label="שלב"
            value={filters.stage}
            onChange={(v) => push({ stage: v })}
            options={STAGE_ORDER.map((s) => ({ value: s, label: STAGE_LABEL[s] }))}
          />
        )}
        <FilterSelect
          icon="person"
          label="אחראי"
          value={filters.owner}
          onChange={(v) => push({ owner: v })}
          options={[{ value: me, label: "שלי" }, { value: "none", label: "ללא אחראי" }, ...staff.filter((s) => s.id !== me).map((s) => ({ value: s.id, label: s.name }))]}
        />
        <FilterSelect
          icon="card"
          label="מנוי"
          value={filters.membership}
          onChange={(v) => push({ membership: v })}
          options={[
            { value: "active", label: "עם מנוי פעיל" },
            { value: "none", label: "בלי מנוי" },
          ]}
        />
        <FilterSelect icon="globe" label="מקור" value={filters.source} onChange={(v) => push({ source: v })} options={Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))} />
        {tags.length > 0 && <FilterSelect icon="star" label="תגית" value={filters.tag} onChange={(v) => push({ tag: v })} options={tags.map((t) => ({ value: t, label: t }))} />}
        <button className="chip" aria-pressed={filters.review} onClick={() => push({ review: !filters.review })}>
          <Icon name="alert" size={15} /> לבדיקה
        </button>
        <button className="chip" aria-pressed={filters.archived} onClick={() => push({ archived: !filters.archived })}>
          <Icon name="archive" size={15} /> בארכיון
        </button>
        {activeFilters > 0 && (
          <button className="chip" onClick={() => push({ stage: "", owner: "", source: "", tag: "", membership: "", review: false, archived: false })}>
            <Icon name="close" size={15} /> ניקוי
          </button>
        )}
      </div>

      <div style={{ opacity: pending ? 0.6 : 1, transition: "opacity 160ms" }} aria-busy={pending}>
        {view === "list" && list && (
          <>
            {list.items.length === 0 ? (
              <div className="card">
                <EmptyState
                  icon="people"
                  title={filters.q || activeFilters ? "לא נמצאו לקוחות" : "עוד אין לקוחות"}
                  text={filters.q || activeFilters ? "נסו חיפוש אחר או נקו את הסינון." : "הוסיפו לקוח ראשון, או ייבאו רשימה קיימת מקובץ."}
                  action={
                    canEdit && !filters.q && !activeFilters ? (
                      <div className="row wrap" style={{ justifyContent: "center" }}>
                        <Button variant="primary" icon="plus" onClick={() => setNewOpen(true)}>
                          לקוח חדש
                        </Button>
                        {canImport && (
                          <Link href="/imports" className="btn">
                            ייבוא מקובץ
                          </Link>
                        )}
                      </div>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <>
                {/* Mobile: cards */}
                <div className="list hide-desktop">
                  {list.items.map((c) => (
                    <Link key={c.id} href={`/contacts/${c.id}`} className="list-item">
                      <Avatar name={c.display_name} />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="row" style={{ gap: 6 }}>
                          <span className="bold truncate">{c.display_name}</span>
                          <Flags c={c} />
                        </div>
                        <div className="xsmall subtle truncate">
                          {c.phone_e164 ? <span className="ltr">{fmtPhone(c.phone_e164)}</span> : "אין טלפון"}
                          {c.owner_name ? ` · ${c.owner_name}` : ""}
                        </div>
                      </div>
                      <Badge tone={STAGE_TONE[c.pipeline_stage]}>{STAGE_LABEL[c.pipeline_stage]}</Badge>
                    </Link>
                  ))}
                </div>
                {/* Desktop: table */}
                <div className="card hide-mobile table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>שם</th>
                        <th>טלפון</th>
                        <th>שלב</th>
                        <th>אחראי</th>
                        <th>מקור</th>
                        <th>עודכן</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.items.map((c) => (
                        <tr key={c.id} className="clickable" onClick={() => router.push(`/contacts/${c.id}`)}>
                          <td>
                            <Link href={`/contacts/${c.id}`} className="row" style={{ gap: 10 }} onClick={(e) => e.stopPropagation()}>
                              <Avatar name={c.display_name} size="sm" />
                              <span className="bold">{c.display_name}</span>
                              <Flags c={c} />
                            </Link>
                            {c.tags.length > 0 && (
                              <div className="row wrap" style={{ gap: 4, marginTop: 4, paddingInlineStart: 42 }}>
                                {c.tags.slice(0, 3).map((t) => (
                                  <span key={t} className="xsmall subtle">
                                    #{t}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td>{c.phone_e164 ? <span className="ltr num">{fmtPhone(c.phone_e164)}</span> : <span className="subtle">—</span>}</td>
                          <td>
                            <Badge tone={STAGE_TONE[c.pipeline_stage]}>{STAGE_LABEL[c.pipeline_stage]}</Badge>
                          </td>
                          <td className={cx(!c.owner_name && "subtle")}>{c.owner_name ?? "—"}</td>
                          <td className="muted small">{SOURCE_LABEL[c.source] ?? c.source}</td>
                          <td className="muted small">{relTime(c.updated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={(p) => push({ page: p })} />
              </>
            )}
          </>
        )}

        {view === "board" && board && (
          <div className="board">
            {board.map((col) => (
              <section key={col.stage} className="board-col" aria-label={STAGE_LABEL[col.stage]}>
                <div className="row between" style={{ marginBottom: 10 }}>
                  <Badge tone={STAGE_TONE[col.stage]} dot>
                    {STAGE_LABEL[col.stage]}
                  </Badge>
                  <span className="xsmall subtle num">{col.total}</span>
                </div>
                {col.items.length === 0 ? (
                  <div className="xsmall subtle" style={{ padding: "18px 4px", textAlign: "center" }}>
                    אין תיקים בשלב הזה
                  </div>
                ) : (
                  col.items.map((c) => (
                    <Link key={c.id} href={`/contacts/${c.id}`} className="board-card">
                      <div className="row" style={{ gap: 6 }}>
                        <span className="bold small truncate grow">{c.display_name}</span>
                        <Flags c={c} />
                      </div>
                      <div className="xsmall subtle truncate">
                        {c.owner_name ?? "ללא אחראי"} · {relTime(c.updated_at)}
                      </div>
                    </Link>
                  ))
                )}
                {col.total > col.items.length && (
                  <button className="btn ghost sm block" style={{ marginTop: 8 }} onClick={() => push({ view: "list", stage: col.stage })}>
                    עוד {col.total - col.items.length}
                  </button>
                )}
              </section>
            ))}
          </div>
        )}
      </div>

      <NewContactSheet open={newOpen} onClose={closeNew} staff={staff} me={me} />
    </div>
  );
}

function Flags({ c }: { c: ContactItem }) {
  return (
    <>
      {!c.contact_allowed && (
        <span title="ביקש/ה שלא ניצור קשר" aria-label="ביקש/ה שלא ניצור קשר" style={{ color: "var(--red)", display: "inline-flex" }}>
          <Icon name="ban" size={15} />
        </span>
      )}
      {(c.needs_review === 1 || c.phone_valid !== 1) && (
        <span title="דורש בדיקה (טלפון חסר / כפילות)" aria-label="דורש בדיקה" style={{ color: "var(--orange)", display: "inline-flex" }}>
          <Icon name="alert" size={15} />
        </span>
      )}
    </>
  );
}

function FilterSelect({ icon, label, value, onChange, options }: { icon: string; label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="chip" aria-pressed={!!value}>
      <Icon name={icon} size={15} />
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="row between" style={{ marginTop: 16 }} aria-label="עמודים">
      <Button size="sm" icon="back" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        הקודם
      </Button>
      <span className="small muted num">
        עמוד {page} מתוך {pages}
      </span>
      <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        הבא
      </Button>
    </nav>
  );
}
