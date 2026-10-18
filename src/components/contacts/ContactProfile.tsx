"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import {
  ATTENDANCE_STATUS_LABEL,
  CHANNEL_LABEL,
  DRAFT_STATUS_LABEL,
  LANG_LABEL,
  MEMBERSHIP_STATUS_LABEL,
  MEMBERSHIP_STATUS_TONE,
  OUTCOME_LABEL,
  PLAN_TYPE_LABEL,
  RULE_ICON,
  RULE_LABEL,
  SOURCE_LABEL,
  STAGE_LABEL,
  STAGE_TONE,
  TASK_STATUS_LABEL,
  eventLabel,
} from "@/lib/i18n";
import { factsLine } from "@/lib/facts";
import { fmtDate, fmtDateTime, fmtPhone, fmtYmd, localInputValue, relTime, tomorrowAt } from "@/lib/format";
import { Icon } from "../Icon";
import { Avatar, Badge, Banner, Button, Checkbox, EmptyState, IconButton, Menu, SelectField, Sheet, Switch, Tabs, TextArea, TextField, useConfirm, useToast } from "../ui";
import { Composer, type ComposerTarget } from "../followup/Composer";
import { OutcomeForm } from "../followup/OutcomeForm";
import { MembershipSheet } from "../memberships/MembershipSheet";
import { MembershipDetailSheet } from "../memberships/MembershipDetailSheet";
import { EditContactSheet } from "./EditContactSheet";
import { MergeSheet } from "./MergeSheet";
import { ActivationSheet } from "./ActivationSheet";
import "@/app/contacts.css";

type Contact = {
  id: string;
  display_name: string;
  phone_e164: string | null;
  phone_raw: string | null;
  phone_valid: number;
  preferred_language: string | null;
  gender_form: string | null;
  pipeline_stage: string;
  stage_reason: string | null;
  owner_id: string | null;
  owner_name: string | null;
  source: string;
  interest: string | null;
  tags: string[];
  needs_review: number;
  review_reason: string | null;
  archived: number;
  version: number;
  created_at: string;
  updated_at: string;
  contact_allowed: boolean;
  contact_block_reason: string | null;
  merged_into: string | null;
};

type Membership = {
  id: string;
  plan_name: string;
  plan_type: string;
  authority: "local" | "external";
  status: string;
  balance: number | null;
  used: number;
  start: string;
  end: string | null;
  paused_now: boolean;
  source_updated_at: string | null;
  reference: string | null;
};

type Task = {
  id: string;
  reason_code: string;
  title: string | null;
  status: string;
  due_at: string;
  assignee_name: string | null;
  outcome: string | null;
  outcome_note: string | null;
  dismiss_reason: string | null;
  completed_at: string | null;
  version: number;
};

type Data = {
  contact: Contact;
  notes: { id: string; body: string; is_private: number; author_name: string | null; created_at: string }[];
  timeline: { at: string; kind: string; title: string; detail?: string | null; actor?: string | null }[];
  memberships: Membership[];
  attendance: { id: string; session_title: string; start_at: string; status: string; channel: string; checked_in_at: string; plan_name: string | null }[];
  tasks: Task[];
  drafts: { id: string; reason_code: string; text: string; status: string; generator: string; created_at: string; invalid_reason: string | null }[];
  suggestions: { id: string; rule_id: string; status: string; status_reason: string | null; facts: Record<string, unknown>; created_at: string; snoozed_until: string | null }[];
  guards: { blocked: boolean; blockReason: string | null; phoneInvalid: boolean; needsReview: boolean; cooldownUntil: string | null; recentContacts: number };
  devices: { id: string; created_at: string; last_used_at: string | null; expires_at: string }[];
};

type Perms = { edit: boolean; merge: boolean; followup: boolean; membershipsView: boolean; membershipsManage: boolean; qr: boolean };
type TabKey = "summary" | "membership" | "attendance" | "followup" | "activity";

const SUG_STATUS: Record<string, string> = { active: "פתוחה", snoozed: "נדחתה", completed: "טופלה", dismissed: "הוחרגה", superseded: "כבר לא רלוונטית" };
const TL_ICON: Record<string, string> = { stage: "layers", interaction: "message", note: "note", consent: "shield" };

export function ContactProfile({ data, staff, tz, perms, initialTab, openEdit }: { data: Data; staff: { id: string; name: string }[]; tz: string; perms: Perms; initialTab?: string; openEdit: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const confirm = useConfirm();
  const c = data.contact;
  const tabs: { value: TabKey; label: string }[] = [
    { value: "summary", label: "סיכום" },
    ...(perms.membershipsView ? [{ value: "membership" as TabKey, label: "מנוי" }] : []),
    { value: "attendance", label: "נוכחות" },
    { value: "followup", label: "מעקב ומשימות" },
    { value: "activity", label: "יומן פעילות" },
  ];
  const [tab, setTab] = useState<TabKey>(tabs.some((t) => t.value === initialTab) ? (initialTab as TabKey) : "summary");
  const [editOpen, setEditOpen] = useState(openEdit);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const [newMembership, setNewMembership] = useState<{ renewFrom: string | null } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [activationOpen, setActivationOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [completeTask, setCompleteTask] = useState<Task | null>(null);
  const [snoozeTask, setSnoozeTask] = useState<Task | null>(null);
  const [dismissTask, setDismissTask] = useState<Task | null>(null);
  const [outcomeOpen, setOutcomeOpen] = useState(false);

  const refresh = () => router.refresh();
  const activeSuggestions = data.suggestions.filter((s) => s.status === "active");
  const openTasks = data.tasks.filter((t) => ["open", "in_progress", "snoozed"].includes(t.status));
  const activeMembership = data.memberships.find((m) => m.status === "active") ?? data.memberships.find((m) => m.status === "pending" || m.status === "paused");
  const firstName = c.display_name.split(/\s+/)[0];

  useEffect(() => {
    if (openEdit) {
      const sp = new URLSearchParams(window.location.search);
      sp.delete("edit");
      window.history.replaceState(null, "", sp.toString() ? `${pathname}?${sp}` : pathname);
    }
  }, [openEdit, pathname]);

  const startMessage = () => {
    const s = activeSuggestions[0];
    const t = openTasks.find((x) => x.status !== "snoozed");
    if (s) setComposer({ contactId: c.id, contactName: c.display_name, rule: s.rule_id, suggestionId: s.id, facts: s.facts });
    else if (t) setComposer({ contactId: c.id, contactName: c.display_name, rule: "R06", taskId: t.id, taskTitle: t.title });
    else setComposer({ contactId: c.id, contactName: c.display_name, rule: "GENERAL" });
  };

  const setArchived = async (archived: boolean) => {
    if (archived) {
      const ok = await confirm({ title: "להעביר לארכיון?", body: "התיק לא יופיע ברשימות ובמעקבים. אפשר להחזיר אותו בכל עת.", confirm: "העברה לארכיון" });
      if (!ok) return;
    }
    try {
      await api(`/api/contacts/${c.id}`, { method: "PATCH", body: { version: c.version, archived } });
      toast(archived ? "התיק הועבר לארכיון" : "התיק הוחזר מהארכיון", "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const allowContact = async () => {
    try {
      await api(`/api/contacts/${c.id}/preference`, { body: { allowed: true } });
      toast("אפשר שוב ליצור קשר בוואטסאפ", "success");
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const copyPhone = async () => {
    if (!c.phone_e164) return;
    try {
      await navigator.clipboard.writeText(c.phone_e164);
      toast("המספר הועתק", "success");
    } catch {
      toast("לא הצלחנו להעתיק", "error");
    }
  };

  const quality: { tone: "warn" | "danger"; text: string; fix?: boolean }[] = [];
  if (!c.phone_e164) quality.push({ tone: "warn", text: "חסר מספר טלפון — אי אפשר לשלוח וואטסאפ.", fix: true });
  else if (c.phone_valid !== 1) quality.push({ tone: "warn", text: "מספר הטלפון לא תקין — צריך לתקן לפני שליחת וואטסאפ.", fix: true });
  if (c.needs_review === 1) quality.push({ tone: "warn", text: c.review_reason === "duplicate_phone" ? "יש תיק אחר עם אותו מספר — כדאי לבדוק ולמזג." : `התיק סומן לבדיקה${c.review_reason && c.review_reason !== "missing_phone" ? `: ${c.review_reason}` : "."}`, fix: true });

  const primary = (() => {
    if (c.archived) return perms.edit ? <Button variant="primary" icon="refresh" onClick={() => setArchived(false)}>החזרה מהארכיון</Button> : null;
    if (!c.contact_allowed) return null;
    if (c.phone_valid !== 1 || !c.phone_e164) return perms.edit ? <Button variant="primary" icon="edit" onClick={() => setEditOpen(true)}>תיקון פרטים</Button> : null;
    if (!perms.followup) return null;
    return (
      <Button variant="primary" icon="message" onClick={startMessage}>
        {activeSuggestions.length || openTasks.length ? "הכנת הודעה" : "הודעה חדשה"}
      </Button>
    );
  })();

  return (
    <div className="page narrow">
      <div className="row" style={{ marginBottom: 12 }}>
        <Link href="/contacts" className="btn ghost sm" style={{ paddingInlineStart: 6 }}>
          <Icon name="back" size={18} /> לקוחות
        </Link>
      </div>

      {/* Header */}
      <section className="card card-pad rise-in" style={{ marginBottom: 16 }}>
        <div className="row start" style={{ gap: 14 }}>
          <Avatar name={c.display_name} size="lg" />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <h1 style={{ fontSize: 24 }}>{c.display_name}</h1>
              <Badge tone={STAGE_TONE[c.pipeline_stage]}>{STAGE_LABEL[c.pipeline_stage]}</Badge>
              {c.archived === 1 && <Badge>בארכיון</Badge>}
              {!c.contact_allowed && (
                <Badge tone="red">
                  <Icon name="ban" size={13} /> לא ליצור קשר
                </Badge>
              )}
            </div>
            <div className="row wrap small muted" style={{ gap: 12, marginTop: 4 }}>
              {c.phone_e164 ? (
                <span className="row" style={{ gap: 4 }}>
                  <a href={`tel:${c.phone_e164}`} className="ltr num" style={{ color: "var(--text)" }}>
                    {fmtPhone(c.phone_e164)}
                  </a>
                  <IconButton icon="copy" label="העתקת המספר" size="sm" onClick={copyPhone} />
                </span>
              ) : (
                <span style={{ color: "var(--orange)" }}>אין טלפון{c.phone_raw ? ` (${c.phone_raw})` : ""}</span>
              )}
              <span>
                <Icon name="person" size={14} style={{ display: "inline", verticalAlign: "-2px" }} /> {c.owner_name ?? "ללא אחראי"}
              </span>
              {activeMembership && (
                <span>
                  <Icon name="card" size={14} style={{ display: "inline", verticalAlign: "-2px" }} /> {activeMembership.plan_name}
                  {activeMembership.balance !== null ? ` · ${activeMembership.balance} שיעורים` : ""}
                </span>
              )}
            </div>
            {c.stage_reason && <div className="xsmall subtle" style={{ marginTop: 4 }}>סיבה: {c.stage_reason}</div>}
          </div>
        </div>
        <div className="row wrap contact-actions" style={{ gap: 8, marginTop: 16 }}>
          {primary}
          {c.phone_e164 && (
            <a href={`tel:${c.phone_e164}`} className="btn">
              <Icon name="phone" size={18} /> שיחה
            </a>
          )}
          {perms.followup && c.contact_allowed && !c.archived && (
            <Button icon="checkCircle" onClick={() => setOutcomeOpen(true)}>
              תיעוד קשר
            </Button>
          )}
          {perms.edit && (
            <Menu
              trigger={(p) => (
                <button {...p} className="btn ghost" aria-label="פעולות נוספות">
                  <Icon name="more" size={18} />
                </button>
              )}
            >
              <button onClick={() => setEditOpen(true)}>
                <Icon name="edit" size={17} /> עריכת פרטים
              </button>
              <button onClick={() => setTaskOpen(true)}>
                <Icon name="tasks" size={17} /> משימה חדשה
              </button>
              {perms.merge && (
                <button onClick={() => setMergeOpen(true)}>
                  <Icon name="merge" size={17} /> מיזוג עם תיק כפול
                </button>
              )}
              <hr />
              {c.archived ? (
                <button onClick={() => setArchived(false)}>
                  <Icon name="refresh" size={17} /> החזרה מהארכיון
                </button>
              ) : (
                <button className="danger" onClick={() => setArchived(true)}>
                  <Icon name="archive" size={17} /> העברה לארכיון
                </button>
              )}
            </Menu>
          )}
        </div>
        {quality.length > 0 && (
          <div className="stack-2" style={{ marginTop: 14 }}>
            {quality.map((q) => (
              <Banner key={q.text} tone={q.tone} action={q.fix && perms.edit ? <Button size="sm" onClick={() => setEditOpen(true)}>לתיקון</Button> : undefined}>
                {q.text}
              </Banner>
            ))}
          </div>
        )}
      </section>

      <Tabs value={tab} onChange={setTab} tabs={tabs} label="אזורי התיק" />

      <div style={{ marginTop: 16 }} className="fade-in" key={tab}>
        {tab === "summary" && (
          <div className="stack-4">
            {activeSuggestions.length > 0 && (
              <section className="card card-pad">
                <div className="section-label">למה צריך מעקב</div>
                <div className="stack-3">
                  {activeSuggestions.map((s) => (
                    <div key={s.id} className="row start" style={{ gap: 10 }}>
                      <span className="tl-icon" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                        <Icon name={RULE_ICON[s.rule_id] ?? "info"} size={16} />
                      </span>
                      <div className="grow">
                        <div className="bold">{RULE_LABEL[s.rule_id]}</div>
                        {factsLine(s.rule_id, s.facts) && <div className="small muted">{factsLine(s.rule_id, s.facts)}</div>}
                      </div>
                      {perms.followup && c.contact_allowed && c.phone_valid === 1 && (
                        <Button size="sm" variant="soft" onClick={() => setComposer({ contactId: c.id, contactName: c.display_name, rule: s.rule_id, suggestionId: s.id, facts: s.facts })}>
                          הכנת הודעה
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="card card-pad">
              <div className="section-label">פרטים</div>
              <dl className="kv contact-kv">
                <dt>שלב</dt>
                <dd>{STAGE_LABEL[c.pipeline_stage]}</dd>
                <dt>מקור</dt>
                <dd>{SOURCE_LABEL[c.source] ?? c.source}</dd>
                <dt>תחום עניין</dt>
                <dd>{c.interest || <span className="subtle">—</span>}</dd>
                <dt>שפת קשר</dt>
                <dd>{c.preferred_language ? LANG_LABEL[c.preferred_language] : <span className="subtle">ברירת המחדל</span>}</dd>
                <dt>לשון פנייה</dt>
                <dd>{c.gender_form === "f" ? "נקבה" : c.gender_form === "m" ? "זכר" : "ניטרלית"}</dd>
                <dt>תגיות</dt>
                <dd>
                  {c.tags.length ? (
                    <span className="row wrap" style={{ gap: 4 }}>
                      {c.tags.map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </span>
                  ) : (
                    <span className="subtle">—</span>
                  )}
                </dd>
                <dt>נוצר</dt>
                <dd>{fmtDate(c.created_at, tz, { day: "numeric", month: "long", year: "numeric" })}</dd>
                {data.guards.cooldownUntil && (
                  <>
                    <dt>פנייה אחרונה</dt>
                    <dd className="small">תקופת המתנה עד {fmtDateTime(data.guards.cooldownUntil, tz)}</dd>
                  </>
                )}
              </dl>
            </section>

            <section className="card card-pad">
              <div className="row between">
                <div>
                  <div className="bold">הודעות בוואטסאפ</div>
                  <div className="small muted">
                    {c.contact_allowed ? "מותר ליצור קשר" : `הלקוח ביקש שלא ניצור קשר${c.contact_block_reason ? ` · ${c.contact_block_reason}` : ""}`}
                  </div>
                </div>
                <Switch
                  label="מותר ליצור קשר בוואטסאפ"
                  checked={c.contact_allowed}
                  disabled={!perms.edit}
                  onChange={(v) => (v ? allowContact() : setBlockOpen(true))}
                />
              </div>
            </section>

            <NotesCard contactId={c.id} notes={data.notes} canEdit={perms.edit} tz={tz} onAdded={refresh} />
          </div>
        )}

        {tab === "membership" && (
          <div className="stack-3">
            {perms.membershipsManage && (
              <div className="row wrap">
                <Button variant="primary" icon="plus" onClick={() => setNewMembership({ renewFrom: null })}>
                  מנוי חדש
                </Button>
                {data.memberships[0] && (
                  <Button icon="refresh" onClick={() => setNewMembership({ renewFrom: (activeMembership ?? data.memberships[0]).id })}>
                    חידוש
                  </Button>
                )}
              </div>
            )}
            {data.memberships.length === 0 ? (
              <div className="card">
                <EmptyState icon="card" title="אין מנויים" text="כשהלקוח יצטרף — יוצרים מנוי, והמעקב והנוכחות יתעדכנו לפיו." />
              </div>
            ) : (
              <div className="list">
                {data.memberships.map((m) => (
                  <button key={m.id} className="list-item" onClick={() => setDetailId(m.id)}>
                    <span className="tl-icon">
                      <Icon name="card" size={16} />
                    </span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="row wrap" style={{ gap: 6 }}>
                        <span className="bold">{m.plan_name}</span>
                        <Badge tone={MEMBERSHIP_STATUS_TONE[m.status]}>{MEMBERSHIP_STATUS_LABEL[m.status]}</Badge>
                        {m.authority === "external" && <Badge tone="blue">ממערכת חיצונית</Badge>}
                      </span>
                      <span className="xsmall subtle" style={{ display: "block" }}>
                        {PLAN_TYPE_LABEL[m.plan_type]} · {fmtYmd(m.start)}
                        {m.end ? ` – ${fmtYmd(m.end)}` : ""}
                        {m.authority === "external" && m.source_updated_at ? ` · עודכן ${relTime(m.source_updated_at)}` : ""}
                      </span>
                    </span>
                    {m.balance !== null && (
                      <span className="col" style={{ alignItems: "center", gap: 0 }}>
                        <span className="bold num" style={{ fontSize: 20 }}>
                          {m.balance}
                        </span>
                        <span className="xsmall subtle">יתרה</span>
                      </span>
                    )}
                    <Icon name="chevron" size={18} className="list-chevron" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "attendance" && (
          <div className="stack-4">
            {perms.qr && (
              <section className="card card-pad">
                <div className="row between start wrap" style={{ gap: 12 }}>
                  <div className="grow">
                    <div className="bold">נוכחות עצמית ב-QR</div>
                    <div className="small muted">
                      {data.devices.length ? `${data.devices.length === 1 ? "טלפון אחד מחובר" : `${data.devices.length} טלפונים מחוברים`} · שימוש אחרון ${relTime(data.devices[0].last_used_at ?? data.devices[0].created_at)}` : "עוד לא חובר טלפון לרישום נוכחות."}
                    </div>
                  </div>
                  <div className="row wrap">
                    <Button icon="smartphone" variant={data.devices.length ? "default" : "primary"} onClick={() => setActivationOpen(true)}>
                      {data.devices.length ? "חיבור טלפון נוסף" : "הפעלת נוכחות בטלפון"}
                    </Button>
                    {data.devices.length > 0 && perms.edit && (
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          const ok = await confirm({ title: "לנתק את הטלפונים?", body: "הלקוח יצטרך קישור הפעלה חדש כדי לרשום נוכחות מהטלפון.", confirm: "ניתוק", danger: true });
                          if (!ok) return;
                          try {
                            await api(`/api/contacts/${c.id}/devices`, { method: "DELETE" });
                            toast("הטלפונים נותקו", "success");
                            refresh();
                          } catch (e) {
                            toast((e as Error).message, "error");
                          }
                        }}
                      >
                        ניתוק מכשירים
                      </Button>
                    )}
                  </div>
                </div>
              </section>
            )}
            {data.attendance.length === 0 ? (
              <div className="card">
                <EmptyState icon="calendar" title="אין רישומי נוכחות" text="כשהלקוח יגיע לשיעור — הנוכחות תופיע כאן." />
              </div>
            ) : (
              <div className="list">
                {data.attendance.map((a) => (
                  <div key={a.id} className="list-item">
                    <span className="tl-icon">
                      <Icon name={a.channel === "qr" ? "qr" : "checkCircle"} size={16} />
                    </span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="bold truncate" style={{ textDecoration: a.status === "reversed" ? "line-through" : undefined }}>
                        {a.session_title}
                      </div>
                      <div className="xsmall subtle">
                        {fmtDate(a.start_at, tz, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} · {CHANNEL_LABEL[a.channel] ?? a.channel}
                        {a.plan_name ? ` · ${a.plan_name}` : ""}
                      </div>
                    </div>
                    {a.status !== "present" && <Badge tone={a.status === "reversed" ? "gray" : "orange"}>{ATTENDANCE_STATUS_LABEL[a.status]}</Badge>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "followup" && (
          <div className="stack-4">
            <section>
              <div className="row between" style={{ marginBottom: 10 }}>
                <h2 className="section-title" style={{ margin: 0 }}>
                  משימות
                </h2>
                {perms.edit && (
                  <Button size="sm" icon="plus" onClick={() => setTaskOpen(true)}>
                    משימה חדשה
                  </Button>
                )}
              </div>
              {data.tasks.length === 0 ? (
                <div className="card">
                  <EmptyState icon="tasks" title="אין משימות" text="קבעו מעקב כדי שלא יישכח." />
                </div>
              ) : (
                <div className="list">
                  {data.tasks.map((t) => {
                    const isOpen = ["open", "in_progress", "snoozed"].includes(t.status);
                    const overdue = isOpen && t.status !== "snoozed" && Date.parse(t.due_at) < Date.now();
                    return (
                      <div key={t.id} className="list-item" style={{ alignItems: "flex-start" }}>
                        <span className="tl-icon" style={isOpen ? undefined : { background: "var(--green-soft)", color: "var(--green)" }}>
                          <Icon name={isOpen ? "tasks" : t.status === "completed" ? "check" : "xCircle"} size={16} />
                        </span>
                        <div className="grow" style={{ minWidth: 0 }}>
                          <div className="bold">{t.title || RULE_LABEL[t.reason_code] || "משימת מעקב"}</div>
                          <div className="xsmall subtle">
                            {isOpen ? (
                              <span style={{ color: overdue ? "var(--red)" : undefined }}>
                                {t.status === "snoozed" ? "נדחתה עד " : overdue ? "באיחור · " : ""}
                                {fmtDateTime(t.due_at, tz)}
                              </span>
                            ) : (
                              <>
                                {TASK_STATUS_LABEL[t.status]}
                                {t.outcome ? ` · ${OUTCOME_LABEL[t.outcome] ?? t.outcome}` : ""}
                                {t.dismiss_reason ? ` · ${t.dismiss_reason}` : ""}
                                {t.completed_at ? ` · ${relTime(t.completed_at)}` : ""}
                              </>
                            )}
                            {t.assignee_name ? ` · ${t.assignee_name}` : ""}
                          </div>
                          {t.outcome_note && <div className="small muted" style={{ marginTop: 4 }}>{t.outcome_note}</div>}
                        </div>
                        {isOpen && perms.edit && (
                          <div className="row" style={{ gap: 4 }}>
                            <Button size="sm" icon="checkCircle" onClick={() => setCompleteTask(t)}>
                              <span className="hide-mobile">השלמה</span>
                            </Button>
                            <Menu
                              trigger={(p) => (
                                <button {...p} className="icon-btn sm" aria-label="פעולות למשימה">
                                  <Icon name="more" size={18} />
                                </button>
                              )}
                            >
                              {perms.followup && c.contact_allowed && c.phone_valid === 1 && (
                                <button onClick={() => setComposer({ contactId: c.id, contactName: c.display_name, rule: "R06", taskId: t.id, taskTitle: t.title })}>
                                  <Icon name="message" size={17} /> הכנת הודעה
                                </button>
                              )}
                              <button onClick={() => setSnoozeTask(t)}>
                                <Icon name="snooze" size={17} /> דחייה
                              </button>
                              <button onClick={() => setDismissTask(t)}>
                                <Icon name="xCircle" size={17} /> החרגה
                              </button>
                            </Menu>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {data.drafts.length > 0 && (
              <section>
                <h2 className="section-title">הודעות שהוכנו</h2>
                <div className="list">
                  {data.drafts.map((d) => (
                    <div key={d.id} className="list-item" style={{ alignItems: "flex-start" }}>
                      <span className="tl-icon">
                        <Icon name={d.generator === "ai" ? "sparkle" : "message"} size={16} />
                      </span>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="row wrap" style={{ gap: 6 }}>
                          <span className="small bold">{RULE_LABEL[d.reason_code] ?? RULE_LABEL.GENERAL}</span>
                          <Badge tone={d.status === "marked_sent" || d.status === "outcome_recorded" ? "green" : d.status === "invalidated" ? "gray" : "blue"}>{DRAFT_STATUS_LABEL[d.status]}</Badge>
                        </div>
                        <div className="small muted" style={{ whiteSpace: "pre-wrap", marginTop: 4, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                          {d.text}
                        </div>
                        <div className="xsmall subtle" style={{ marginTop: 2 }}>{relTime(d.created_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {data.suggestions.length > 0 && (
              <section>
                <h2 className="section-title">סיבות מעקב</h2>
                <div className="list">
                  {data.suggestions.map((s) => (
                    <div key={s.id} className="list-item">
                      <Icon name={RULE_ICON[s.rule_id] ?? "info"} size={18} />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="small bold">{RULE_LABEL[s.rule_id]}</div>
                        <div className="xsmall subtle">
                          {relTime(s.created_at)}
                          {s.status_reason && s.status !== "active" ? ` · ${OUTCOME_LABEL[s.status_reason] ?? s.status_reason}` : ""}
                        </div>
                      </div>
                      <Badge tone={s.status === "active" ? "accent" : "gray"}>{SUG_STATUS[s.status] ?? s.status}</Badge>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {tab === "activity" && (
          <section className="card card-pad">
            {data.timeline.length === 0 ? (
              <EmptyState icon="history" title="אין פעילות עדיין" />
            ) : (
              <div className="timeline">
                {data.timeline.map((it, i) => (
                  <div key={i} className="tl-item">
                    <span className="tl-icon">
                      <Icon name={TL_ICON[it.kind] ?? "info"} size={15} />
                    </span>
                    <div className="grow" style={{ minWidth: 0, paddingTop: 5 }}>
                      <div className="small bold">{eventLabel(it.title)}</div>
                      {it.detail && <div className="small muted" style={{ whiteSpace: "pre-wrap" }}>{it.detail}</div>}
                      <div className="xsmall subtle">
                        {fmtDateTime(it.at, tz)}
                        {it.actor ? ` · ${it.actor}` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Sheets */}
      {perms.edit && <EditContactSheet open={editOpen} onClose={() => setEditOpen(false)} contact={c} staff={staff} hasMembership={data.memberships.some((m) => m.status !== "cancelled")} />}
      {perms.merge && <MergeSheet open={mergeOpen} onClose={() => setMergeOpen(false)} keep={c} />}
      <Composer target={composer} open={!!composer} onClose={() => setComposer(null)} onDone={refresh} />
      {perms.membershipsManage && (
        <MembershipSheet
          open={!!newMembership}
          onClose={() => setNewMembership(null)}
          contactId={c.id}
          contactName={c.display_name}
          renewFrom={newMembership?.renewFrom ?? null}
          onDone={() => {
            setNewMembership(null);
            refresh();
          }}
        />
      )}
      {perms.membershipsView && <MembershipDetailSheet membershipId={detailId} open={!!detailId} onClose={() => setDetailId(null)} onChanged={refresh} />}
      {perms.qr && <ActivationSheet open={activationOpen} onClose={() => setActivationOpen(false)} contactId={c.id} firstName={firstName} phone={c.phone_valid === 1 ? c.phone_e164 : null} tz={tz} onCreated={() => {}} />}
      <BlockSheet open={blockOpen} onClose={() => setBlockOpen(false)} contactId={c.id} onDone={refresh} />
      <NewTaskSheet open={taskOpen} onClose={() => setTaskOpen(false)} contactId={c.id} defaultAssignee={c.owner_id} staff={staff} onDone={refresh} />
      <Sheet open={!!completeTask} onClose={() => setCompleteTask(null)} title="השלמת משימה" subtitle={completeTask?.title ?? undefined}>
        {completeTask && (
          <OutcomeForm
            target={{
              contactId: c.id,
              taskId: completeTask.id,
              taskVersion: completeTask.version,
              defaultChannel: "call",
              memberships: data.memberships.filter((m) => m.status !== "cancelled").map((m) => ({ id: m.id, plan_name: m.plan_name, status: m.status })),
            }}
            onSaved={() => {
              setCompleteTask(null);
              toast("המשימה הושלמה", "success");
              refresh();
            }}
          />
        )}
      </Sheet>
      <Sheet open={outcomeOpen} onClose={() => setOutcomeOpen(false)} title="תיעוד קשר" subtitle={c.display_name}>
        {outcomeOpen && (
          <OutcomeForm
            target={{
              contactId: c.id,
              suggestionId: activeSuggestions[0]?.id,
              defaultChannel: "call",
              memberships: data.memberships.filter((m) => m.status !== "cancelled").map((m) => ({ id: m.id, plan_name: m.plan_name, status: m.status })),
            }}
            onSaved={() => {
              setOutcomeOpen(false);
              toast("הקשר תועד", "success");
              refresh();
            }}
          />
        )}
      </Sheet>
      <TaskActionSheet task={snoozeTask} mode="snooze" onClose={() => setSnoozeTask(null)} onDone={refresh} />
      <TaskActionSheet task={dismissTask} mode="dismiss" onClose={() => setDismissTask(null)} onDone={refresh} />
    </div>
  );
}

function NotesCard({ contactId, notes, canEdit, tz, onAdded }: { contactId: string; notes: Data["notes"]; canEdit: boolean; tz: string; onAdded: () => void }) {
  const toast = useToast();
  const [body, setBody] = useState("");
  const [priv, setPriv] = useState(false);
  const [saving, setSaving] = useState(false);
  const add = async () => {
    setSaving(true);
    try {
      await api(`/api/contacts/${contactId}/notes`, { body: { body, is_private: priv } });
      setBody("");
      setPriv(false);
      toast("ההערה נשמרה", "success");
      onAdded();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="card card-pad">
      <div className="section-label">הערות</div>
      {canEdit && (
        <div className="stack-2" style={{ marginBottom: 14 }}>
          <textarea className="textarea" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="סיכום שיחה, העדפות, מה חשוב לזכור… (בלי מידע רפואי)" aria-label="הערה חדשה" />
          <div className="row between">
            <Checkbox checked={priv} onChange={setPriv}>
              <span className="small">הערה פנימית (לא נשלחת לעוזר הניסוח)</span>
            </Checkbox>
            <Button size="sm" variant="primary" disabled={!body.trim()} loading={saving} onClick={add}>
              הוספה
            </Button>
          </div>
        </div>
      )}
      {notes.length === 0 ? (
        <div className="small subtle">אין הערות עדיין.</div>
      ) : (
        <div className="stack-3">
          {notes.map((n) => (
            <div key={n.id} style={{ paddingTop: 10, borderTop: "1px solid var(--line)" }}>
              <div style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
              <div className="xsmall subtle" style={{ marginTop: 2 }}>
                {n.author_name ?? "מערכת"} · {fmtDateTime(n.created_at, tz)}
                {n.is_private ? " · פנימית" : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function BlockSheet({ open, onClose, contactId, onDone }: { open: boolean; onClose: () => void; contactId: string; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/contacts/${contactId}/preference`, { body: { allowed: false, reason } });
      toast("נשמר: לא ליצור קשר", "success");
      setReason("");
      onClose();
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="חסימת יצירת קשר"
      footer={
        <>
          <Button onClick={onClose}>ביטול</Button>
          <Button variant="danger" loading={saving} disabled={!reason.trim()} onClick={save}>
            חסימה
          </Button>
        </>
      }
    >
      <div className="stack-3">
        <p className="small muted">מעכשיו לא יוכנו הודעות ולא יוצגו מעקבים שיווקיים ללקוח הזה. טיוטות קיימות יבוטלו.</p>
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="chips" style={{ marginInline: 0, paddingInline: 0, flexWrap: "wrap" }}>
          {["ביקש/ה להפסיק לקבל הודעות", "מעדיף/ה שיחות טלפון בלבד", "לא רלוונטי"].map((r) => (
            <button key={r} className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
        <TextArea label="סיבה" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Sheet>
  );
}

function NewTaskSheet({ open, onClose, contactId, defaultAssignee, staff, onDone }: { open: boolean; onClose: () => void; contactId: string; defaultAssignee: string | null; staff: { id: string; name: string }[]; onDone: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(localInputValue(tomorrowAt(10)));
  const [assignee, setAssignee] = useState(defaultAssignee ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setTitle("");
      setDue(localInputValue(tomorrowAt(10)));
      setAssignee(defaultAssignee ?? "");
      setErrors({});
    }
  }, [open, defaultAssignee]);
  const save = async () => {
    setSaving(true);
    try {
      await api("/api/tasks", { body: { contact_id: contactId, title, due_at: new Date(due).toISOString(), assignee_id: assignee || null } });
      toast("המשימה נוצרה", "success");
      onClose();
      onDone();
    } catch (e) {
      const err = e as { fields?: Record<string, string>; message: string };
      if (err.fields) setErrors(err.fields);
      else toast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="משימה חדשה"
      footer={
        <>
          <Button onClick={onClose}>ביטול</Button>
          <Button variant="primary" loading={saving} disabled={!title.trim() || !due} onClick={save}>
            יצירה
          </Button>
        </>
      }
    >
      <div className="stack-4">
        <TextField label="מה צריך לעשות?" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="למשל: לחזור אחרי החגים" />
        <div className="chips" style={{ marginInline: 0, paddingInline: 0, flexWrap: "wrap" }}>
          {[
            { label: "מחר", days: 1 },
            { label: "בעוד 3 ימים", days: 3 },
            { label: "בעוד שבוע", days: 7 },
          ].map((p) => {
            const d = tomorrowAt(10);
            d.setDate(d.getDate() + p.days - 1);
            const val = localInputValue(d);
            return (
              <button key={p.label} type="button" className="chip" aria-pressed={due === val} onClick={() => setDue(val)}>
                {p.label}
              </button>
            );
          })}
        </div>
        <TextField label="מתי" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} error={errors.due_at} />
        <SelectField label="אחראי" value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="ללא אחראי" options={staff.map((s) => ({ value: s.id, label: s.name }))} error={errors.assignee_id} />
      </div>
    </Sheet>
  );
}

function TaskActionSheet({ task, mode, onClose, onDone }: { task: Task | null; mode: "snooze" | "dismiss"; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState(localInputValue(tomorrowAt(10)));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (task) {
      setValue(localInputValue(tomorrowAt(10)));
      setReason("");
      setError(null);
    }
  }, [task]);
  const save = async () => {
    if (!task) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: mode === "snooze" ? { action: "snooze", version: task.version, snoozed_until: new Date(value).toISOString(), snooze_reason: reason || undefined } : { action: "dismiss", version: task.version, dismiss_reason: reason },
      });
      toast(mode === "snooze" ? "המשימה נדחתה" : "המשימה הוחרגה", "success");
      onClose();
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet
      open={!!task}
      onClose={onClose}
      title={mode === "snooze" ? "דחיית משימה" : "החרגת משימה"}
      subtitle={task?.title ?? undefined}
      footer={
        <>
          <Button onClick={onClose}>ביטול</Button>
          <Button variant="primary" loading={saving} disabled={mode === "dismiss" ? !reason.trim() : !value} onClick={save}>
            {mode === "snooze" ? "דחייה" : "החרגה"}
          </Button>
        </>
      }
    >
      <div className="stack-3">
        {error && <Banner tone="danger">{error}</Banner>}
        {mode === "snooze" && <TextField label="מועד חדש" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />}
        <TextArea label={mode === "snooze" ? "סיבה" : "למה מחריגים?"} optional={mode === "snooze"} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Sheet>
  );
}
