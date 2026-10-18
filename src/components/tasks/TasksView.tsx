"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { RULE_ICON, RULE_LABEL, TASK_STATUS_LABEL, OUTCOME_LABEL } from "@/lib/i18n";
import { fmtDateTime, localInputValue, relTime, tomorrowAt } from "@/lib/format";
import { Icon } from "../Icon";
import { Avatar, Badge, Banner, Button, EmptyState, Menu, Segmented, SelectField, Sheet, Skeleton, Switch, TextArea, TextField, useToast, cx } from "../ui";
import { Composer, type ComposerTarget } from "../followup/Composer";
import { OutcomeForm } from "../followup/OutcomeForm";
import { ContactPicker, type PickedContact } from "./ContactPicker";

type View = "today" | "overdue" | "snoozed" | "upcoming" | "done";

export type TaskItem = {
  id: string;
  contact_id: string;
  contact_name: string;
  contact_phone: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  reason_code: string;
  title: string | null;
  status: string;
  due_at: string;
  snoozed_until: string | null;
  outcome: string | null;
  outcome_note: string | null;
  dismiss_reason: string | null;
  completed_at: string | null;
  version: number;
};

type Counts = { today: number; overdue: number; snoozed: number; upcoming: number };

const EMPTY: Record<View, { title: string; text: string }> = {
  today: { title: "אין משימות להיום", text: "משימות שמועדן היום יופיעו כאן." },
  overdue: { title: "אין משימות באיחור", text: "כל הכבוד — הכל בזמן." },
  snoozed: { title: "אין משימות דחויות", text: "משימות שנדחו למועד אחר יופיעו כאן." },
  upcoming: { title: "אין משימות קרובות", text: "אפשר ליצור משימת מעקב לכל לקוח." },
  done: { title: "עדיין אין משימות שהושלמו", text: "משימות שהושלמו או הוחרגו יופיעו כאן." },
};

export const taskTitle = (t: { title: string | null; reason_code: string }) => t.title || RULE_LABEL[t.reason_code] || "משימת מעקב";

export function TasksView({
  initialView,
  initial,
  staff,
  me,
  tz,
  canFollowup,
}: {
  initialView: View;
  initial: { items: TaskItem[]; counts: Counts };
  staff: { id: string; name: string }[];
  me: { id: string; name: string };
  tz: string;
  canFollowup: boolean;
}) {
  const toast = useToast();
  const [view, setView] = useState<View>(initialView);
  const [mine, setMine] = useState(false);
  const [items, setItems] = useState<TaskItem[]>(initial.items);
  const [counts, setCounts] = useState<Counts>(initial.counts);
  const [loading, setLoading] = useState(false);
  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const [completing, setCompleting] = useState<TaskItem | null>(null);
  const [snoozing, setSnoozing] = useState<TaskItem | null>(null);
  const [dismissing, setDismissing] = useState<TaskItem | null>(null);
  const [assigning, setAssigning] = useState<TaskItem | null>(null);
  const [creating, setCreating] = useState(false);
  const first = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ items: TaskItem[]; counts: Counts }>(`/api/tasks?view=${view}${mine ? "&mine=1" : ""}`);
      setItems(d.items);
      setCounts(d.counts);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [view, mine, toast]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    load();
  }, [load]);

  /** PATCH with optimistic version; a 409 means a colleague changed it (AC-11). */
  const patch = async (t: TaskItem, body: Record<string, unknown>, success: string) => {
    try {
      await api(`/api/tasks/${t.id}`, { method: "PATCH", body: { ...body, version: t.version } });
      toast(success, "success");
      await load();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast("מישהו אחר עדכן את המשימה בינתיים. הרשימה רועננה.", "error");
        await load();
      } else toast((e as Error).message, "error");
      return false;
    }
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">משימות</h1>
          <p className="page-sub">
            {counts.overdue ? `${counts.overdue} באיחור · ` : ""}
            {counts.today} להיום
          </p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          <span className="hide-mobile">משימה חדשה</span>
          <span className="hide-desktop">חדשה</span>
        </Button>
      </div>

      <div className="row between wrap" style={{ gap: 12, marginBottom: 16 }}>
        <div style={{ maxWidth: "100%", overflowX: "auto" }}>
          <Segmented
            label="תצוגת משימות"
            value={view}
            onChange={setView}
            options={[
              { value: "today", label: "היום", count: counts.today },
              { value: "overdue", label: "באיחור", count: counts.overdue },
              { value: "upcoming", label: "קרובות", count: counts.upcoming },
              { value: "snoozed", label: "נדחו", count: counts.snoozed },
              { value: "done", label: "הושלמו" },
            ]}
          />
        </div>
        <label className="row small" style={{ gap: 8, cursor: "pointer" }}>
          <Switch checked={mine} onChange={setMine} label="רק המשימות שלי" />
          <span>רק שלי</span>
        </label>
      </div>

      {loading && items.length === 0 ? (
        <div className="stack-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={84} radius={16} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={view === "overdue" ? "checkCircle" : "tasks"}
            title={EMPTY[view].title}
            text={EMPTY[view].text}
            action={
              view !== "done" ? (
                <Button icon="plus" onClick={() => setCreating(true)}>
                  משימה חדשה
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="stack-2" style={{ opacity: loading ? 0.6 : 1, transition: "opacity 160ms" }}>
          {items.map((t, idx) => {
            const open = ["open", "in_progress", "snoozed"].includes(t.status);
            const overdue = open && new Date(t.due_at) < today;
            return (
              <article key={t.id} className="fu-card" style={{ animationDelay: `${Math.min(idx, 8) * 25}ms`, padding: 14 }}>
                <div className="grow stack-2" style={{ minWidth: 0 }}>
                  <div className="row between start" style={{ gap: 8 }}>
                    <div className="row start" style={{ gap: 10, minWidth: 0 }}>
                      <span className="tl-icon" style={{ background: overdue ? "var(--red-soft)" : "var(--accent-soft)", color: overdue ? "var(--red)" : "var(--accent)" }}>
                        <Icon name={RULE_ICON[t.reason_code] ?? "tasks"} size={16} />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div className="bold" style={{ fontSize: 15.5, textDecoration: t.status === "completed" ? "line-through" : undefined, color: open ? undefined : "var(--text-2)" }}>
                          {taskTitle(t)}
                        </div>
                        <Link href={`/contacts/${t.contact_id}`} className="row small" style={{ gap: 6, color: "var(--text-2)" }}>
                          <Avatar name={t.contact_name} size="sm" />
                          <span className="truncate">{t.contact_name}</span>
                        </Link>
                      </div>
                    </div>
                    <div className="col" style={{ alignItems: "flex-end", gap: 4, flex: "none" }}>
                      {open ? (
                        <span className={cx("badge", overdue ? "red" : "gray")} title={fmtDateTime(t.due_at, tz)}>
                          <Icon name="clock" size={13} />
                          {t.status === "snoozed" ? `נדחתה ל${fmtDateTime(t.snoozed_until ?? t.due_at, tz)}` : relTime(t.due_at)}
                        </span>
                      ) : (
                        <Badge tone={t.status === "completed" ? "green" : "gray"}>{TASK_STATUS_LABEL[t.status]}</Badge>
                      )}
                      {t.status === "in_progress" && (
                        <Badge tone="purple">
                          <Icon name="person" size={13} /> בטיפול{t.assignee_name ? ` · ${t.assignee_name}` : ""}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="xsmall subtle row wrap" style={{ gap: 6 }}>
                    <span>
                      <Icon name="person" size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> {t.assignee_name ?? "ללא אחראי"}
                    </span>
                    {t.outcome && <span>· {OUTCOME_LABEL[t.outcome] ?? t.outcome}</span>}
                    {t.outcome_note && <span className="truncate">· {t.outcome_note}</span>}
                    {t.dismiss_reason && <span>· {t.dismiss_reason}</span>}
                    {t.completed_at && <span>· {relTime(t.completed_at)}</span>}
                  </div>

                  <div className="row wrap" style={{ gap: 8, marginTop: 2 }}>
                    {open ? (
                      <>
                        {canFollowup && t.reason_code !== "REG" && (
                          <Button
                            size="sm"
                            variant="primary"
                            icon="message"
                            onClick={() =>
                              setComposer({ contactId: t.contact_id, contactName: t.contact_name, rule: "R06", taskId: t.id, taskTitle: taskTitle(t) })
                            }
                          >
                            הכנת הודעה
                          </Button>
                        )}
                        <Button size="sm" variant={t.reason_code === "REG" ? "primary" : "default"} icon="checkCircle" onClick={() => setCompleting(t)}>
                          השלמה
                        </Button>
                        {t.status !== "in_progress" && (
                          <Button size="sm" variant="ghost" icon="play" onClick={() => patch(t, { action: "start" }, "סומן שאת/ה מטפל/ת")}>
                            <span className="hide-mobile">אני מטפל/ת</span>
                          </Button>
                        )}
                        <Menu
                          trigger={(p) => (
                            <button {...p} className="icon-btn sm" aria-label="פעולות נוספות" style={{ marginInlineStart: "auto" }}>
                              <Icon name="more" size={18} />
                            </button>
                          )}
                        >
                          <button onClick={() => setSnoozing(t)}>
                            <Icon name="snooze" size={17} /> דחייה
                          </button>
                          <button onClick={() => setAssigning(t)}>
                            <Icon name="person" size={17} /> שיוך לאחראי אחר
                          </button>
                          <Link href={`/contacts/${t.contact_id}`}>
                            <Icon name="person" size={17} /> פתיחת התיק
                          </Link>
                          <hr />
                          <button onClick={() => setDismissing(t)}>
                            <Icon name="xCircle" size={17} /> החרגת המשימה
                          </button>
                        </Menu>
                      </>
                    ) : (
                      t.status !== "superseded" && (
                        <Button size="sm" variant="ghost" icon="refresh" onClick={() => patch(t, { action: "reopen" }, "המשימה נפתחה מחדש")}>
                          פתיחה מחדש
                        </Button>
                      )
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Composer target={composer} open={!!composer} onClose={() => setComposer(null)} onDone={load} />

      <Sheet open={!!completing} onClose={() => setCompleting(null)} title="השלמת משימה" subtitle={completing ? `${taskTitle(completing)} · ${completing.contact_name}` : undefined}>
        {completing && (
          <OutcomeForm
            target={{ contactId: completing.contact_id, taskId: completing.id, taskVersion: completing.version, defaultChannel: "call" }}
            onSaved={() => {
              toast("המשימה הושלמה", "success");
              setCompleting(null);
              load();
            }}
            submitLabel="השלמת המשימה"
          />
        )}
      </Sheet>

      <SnoozeSheet
        task={snoozing}
        onClose={() => setSnoozing(null)}
        onPick={async (d, reason) => {
          if (!snoozing) return;
          if (await patch(snoozing, { action: "snooze", snoozed_until: d.toISOString(), snooze_reason: reason }, "המשימה נדחתה")) setSnoozing(null);
        }}
      />

      <ReasonSheet
        open={!!dismissing}
        onClose={() => setDismissing(null)}
        title="החרגת משימה"
        subtitle={dismissing?.contact_name}
        hint="החרגה אינה נחשבת יצירת קשר. הסיבה נשמרת."
        presets={["טופל מחוץ למערכת", "כבר לא רלוונטי", "כפילות"]}
        submit="החרגה"
        onSubmit={async (reason) => {
          if (dismissing && (await patch(dismissing, { action: "dismiss", dismiss_reason: reason }, "המשימה הוחרגה"))) setDismissing(null);
        }}
      />

      <AssignSheet
        task={assigning}
        staff={staff}
        me={me}
        onClose={() => setAssigning(null)}
        onPick={async (id) => {
          if (assigning && (await patch(assigning, { action: "assign", assignee_id: id || null }, "האחראי עודכן"))) setAssigning(null);
        }}
      />

      <NewTaskSheet open={creating} onClose={() => setCreating(false)} staff={staff} me={me} onCreated={load} />
    </div>
  );
}

function SnoozeSheet({ task, onClose, onPick }: { task: TaskItem | null; onClose: () => void; onPick: (d: Date, reason?: string) => void }) {
  const [custom, setCustom] = useState(localInputValue(tomorrowAt(10)));
  const [reason, setReason] = useState("");
  const presets: { label: string; date: () => Date }[] = [
    { label: "מחר בבוקר", date: () => tomorrowAt(9) },
    { label: "בעוד 3 ימים", date: () => { const d = tomorrowAt(9); d.setDate(d.getDate() + 2); return d; } },
    { label: "בעוד שבוע", date: () => { const d = tomorrowAt(9); d.setDate(d.getDate() + 6); return d; } },
  ];
  return (
    <Sheet
      open={!!task}
      onClose={onClose}
      title="דחיית משימה"
      subtitle={task?.contact_name}
      footer={
        <>
          <Button onClick={onClose}>ביטול</Button>
          <Button variant="primary" disabled={!custom || new Date(custom) <= new Date()} onClick={() => onPick(new Date(custom), reason.trim() || undefined)}>
            דחייה למועד שנבחר
          </Button>
        </>
      }
    >
      <div className="stack-4">
        <div className="grid-3">
          {presets.map((p) => (
            <button key={p.label} type="button" className="stat pressable" style={{ cursor: "pointer", textAlign: "center" }} onClick={() => onPick(p.date(), reason.trim() || undefined)}>
              <Icon name="clock" size={20} style={{ margin: "0 auto 6px", color: "var(--accent)" }} />
              <div className="small bold">{p.label}</div>
            </button>
          ))}
        </div>
        <TextField label="או מועד אחר" type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <TextField label="סיבה" optional value={reason} onChange={(e) => setReason(e.target.value)} placeholder="למשל: ביקש/ה לחזור אחרי החגים" />
      </div>
    </Sheet>
  );
}

function ReasonSheet({
  open,
  onClose,
  title,
  subtitle,
  hint,
  presets,
  submit,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  hint?: string;
  presets: string[];
  submit: string;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={
        <>
          <Button onClick={onClose}>ביטול</Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!reason.trim()}
            onClick={async () => {
              setSaving(true);
              await onSubmit(reason.trim());
              setSaving(false);
            }}
          >
            {submit}
          </Button>
        </>
      }
    >
      <div className="stack-3">
        {hint && <p className="small muted">{hint}</p>}
        <div className="chips" style={{ marginInline: 0, paddingInline: 0, flexWrap: "wrap" }}>
          {presets.map((r) => (
            <button key={r} type="button" className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
        <TextArea label="סיבה" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Sheet>
  );
}

function AssignSheet({ task, staff, me, onClose, onPick }: { task: TaskItem | null; staff: { id: string; name: string }[]; me: { id: string }; onClose: () => void; onPick: (id: string) => void }) {
  return (
    <Sheet open={!!task} onClose={onClose} title="שיוך משימה" subtitle={task ? taskTitle(task) : undefined}>
      <div className="list">
        {staff.map((s) => (
          <button key={s.id} className="list-item" onClick={() => onPick(s.id)} aria-pressed={task?.assignee_id === s.id}>
            <Avatar name={s.name} size="sm" />
            <span className="grow bold">
              {s.name}
              {s.id === me.id ? <span className="subtle small"> (אני)</span> : null}
            </span>
            {task?.assignee_id === s.id && <Icon name="check" size={18} style={{ color: "var(--accent)" }} />}
          </button>
        ))}
        <button className="list-item" onClick={() => onPick("")}>
          <span className="avatar sm" style={{ background: "var(--surface-3)", color: "var(--text-3)" }}>
            —
          </span>
          <span className="grow">ללא אחראי</span>
        </button>
      </div>
    </Sheet>
  );
}

export function NewTaskSheet({
  open,
  onClose,
  staff,
  me,
  onCreated,
  contact: fixedContact,
}: {
  open: boolean;
  onClose: () => void;
  staff: { id: string; name: string }[];
  me: { id: string };
  onCreated: () => void;
  contact?: PickedContact | null;
}) {
  const toast = useToast();
  const [contact, setContact] = useState<PickedContact | null>(fixedContact ?? null);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(localInputValue(tomorrowAt(10)));
  const [assignee, setAssignee] = useState(me.id);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setContact(fixedContact ?? null);
    setTitle("");
    setDue(localInputValue(tomorrowAt(10)));
    setAssignee(me.id);
    setErrors({});
    setMessage(null);
  }, [open, fixedContact, me.id]);

  const quick = (days: number, hour = 10) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    setDue(localInputValue(d));
  };

  const save = async () => {
    if (!contact) return;
    setSaving(true);
    setErrors({});
    setMessage(null);
    try {
      await api("/api/tasks", { body: { contact_id: contact.id, title: title.trim() || undefined, due_at: new Date(due).toISOString(), assignee_id: assignee || null } });
      toast("המשימה נוצרה", "success");
      onCreated();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      setMessage(e instanceof ApiError && e.fields ? null : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="משימה חדשה"
      subtitle={contact?.display_name}
      footer={
        contact ? (
          <>
            <Button onClick={onClose}>ביטול</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              יצירת משימה
            </Button>
          </>
        ) : undefined
      }
    >
      {!contact ? (
        <ContactPicker autoFocus onPick={setContact} />
      ) : (
        <div className="stack-4">
          {message && <Banner tone="danger">{message}</Banner>}
          {!fixedContact && (
            <div className="row card card-pad" style={{ padding: 12 }}>
              <Avatar name={contact.display_name} size="sm" />
              <span className="grow bold">{contact.display_name}</span>
              <Button size="sm" variant="ghost" onClick={() => setContact(null)}>
                החלפה
              </Button>
            </div>
          )}
          <TextField label="מה צריך לעשות?" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="למשל: לחזור עם פרטים על מסלול ערב" autoFocus />
          <div className="stack-2">
            <TextField label="מתי?" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} error={errors.due_at} />
            <div className="chips" style={{ marginInline: 0, paddingInline: 0, flexWrap: "wrap" }}>
              <button type="button" className="chip" onClick={() => quick(0, Math.min(new Date().getHours() + 1, 23))}>
                היום
              </button>
              <button type="button" className="chip" onClick={() => quick(1)}>
                מחר
              </button>
              <button type="button" className="chip" onClick={() => quick(3)}>
                בעוד 3 ימים
              </button>
              <button type="button" className="chip" onClick={() => quick(7)}>
                בעוד שבוע
              </button>
            </div>
          </div>
          <SelectField
            label="אחראי/ת"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            error={errors.assignee_id}
            options={[...staff.map((s) => ({ value: s.id, label: s.id === me.id ? `${s.name} (אני)` : s.name })), { value: "", label: "ללא אחראי" }]}
          />
        </div>
      )}
    </Sheet>
  );
}
