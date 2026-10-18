"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { factsLine, type FactsLike } from "@/lib/facts";
import { RULE_ACTION, RULE_ICON, RULE_LABEL, RULE_SHORT, STAGE_LABEL, STAGE_TONE, EXCLUDED_LABEL, OUTCOME_LABEL } from "@/lib/i18n";
import { localInputValue, relTime, tomorrowAt } from "@/lib/format";
import { Icon } from "../Icon";
import { Avatar, Badge, Banner, Button, EmptyState, IconButton, Menu, Sheet, TextArea, TextField, useToast, cx } from "../ui";
import { Composer, type ComposerTarget } from "./Composer";
import { OutcomeForm, type OutcomeTarget } from "./OutcomeForm";

type Reason = {
  kind: "rule" | "task";
  rule: string;
  suggestionId?: string;
  taskId?: string;
  title?: string | null;
  facts?: FactsLike;
  priority: number;
  dueAt: string;
  status?: string;
  assignee?: string | null;
};

type Card = {
  contactId: string;
  name: string;
  phone: string | null;
  stage: string;
  ownerId: string | null;
  ownerName: string | null;
  source: string;
  reasons: Reason[];
  priority: number;
  dueAt: string;
  overdue: boolean;
  lastContact: { at: string; type: string; outcome: string | null } | null;
  guards: { blocked: boolean; phoneInvalid: boolean; needsReview: boolean; cooldownUntil: string | null };
};

type TodayData = {
  cards: Card[];
  counts: { needFollowup: number; overdue: number; endingSoon: number };
  excluded: { contactId: string; name: string; rule: string; reason: string }[];
  freshness: { stale: boolean; lastImportAt: string | null; externalMemberships: number };
  evaluatedAt: string;
};

const level = (p: number) => (p <= 4 ? "high" : p <= 6 ? "medium" : "low");
const LEVEL_LABEL = { high: "עדיפות גבוהה", medium: "עדיפות בינונית", low: "עדיפות נמוכה" };

export function TodayView({
  initial,
  staff,
  me,
  canFollowup,
  canSettings,
}: {
  initial: TodayData;
  staff: { id: string; name: string }[];
  me: { id: string; name: string };
  tz: string;
  canFollowup: boolean;
  canSettings: boolean;
}) {
  const toast = useToast();
  const [data, setData] = useState<TodayData>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<"all" | "overdue" | "ending">("all");
  const [owner, setOwner] = useState<string>("");
  const [rule, setRule] = useState<string>("");
  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const [outcome, setOutcome] = useState<(OutcomeTarget & { name: string }) | null>(null);
  const [dismiss, setDismiss] = useState<{ suggestionId?: string; taskId?: string; name: string; version?: number } | null>(null);
  const [custom, setCustom] = useState<{ reason: Reason; name: string } | null>(null);
  const [override, setOverride] = useState<{ contactId: string; name: string } | null>(null);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const d = await api<TodayData>("/api/followups/today");
      setData(d);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setRefreshing(false);
    }
  }, [toast]);

  const removeCard = (contactId: string) => {
    setLeaving((s) => new Set(s).add(contactId));
    setTimeout(() => {
      refresh().then(() => setLeaving((s) => {
        const n = new Set(s);
        n.delete(contactId);
        return n;
      }));
    }, 220);
  };

  const snooze = async (r: Reason, contactId: string, until: Date) => {
    try {
      if (r.suggestionId) await api(`/api/suggestions/${r.suggestionId}/snooze`, { body: { until: until.toISOString() } });
      else if (r.taskId) {
        const t = await api<{ version: number }>(`/api/tasks/${r.taskId}`);
        await api(`/api/tasks/${r.taskId}`, { method: "PATCH", body: { action: "snooze", version: t.version, snoozed_until: until.toISOString() } });
      }
      toast("נדחה למועד אחר", "success");
      removeCard(contactId);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const cards = useMemo(() => {
    let list = data.cards;
    if (view === "overdue") list = list.filter((c) => c.overdue);
    if (view === "ending") list = list.filter((c) => c.reasons.some((r) => r.rule === "R03" || r.rule === "R04"));
    if (owner === "me") list = list.filter((c) => c.ownerId === me.id || c.reasons.some((r) => r.assignee === me.name));
    else if (owner === "none") list = list.filter((c) => !c.ownerId);
    else if (owner) list = list.filter((c) => c.ownerId === owner);
    if (rule) list = list.filter((c) => c.reasons.some((r) => r.rule === rule));
    return list;
  }, [data.cards, view, owner, rule, me]);

  const rulesPresent = Array.from(new Set(data.cards.flatMap((c) => c.reasons.map((r) => r.rule))));
  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "בוקר טוב" : h < 17 ? "צהריים טובים" : "ערב טוב";
  })();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">
            {greeting}, {me.name.split(" ")[0]}
          </h1>
          <p className="page-sub">
            {data.counts.needFollowup ? `${data.counts.needFollowup} אנשים מחכים למעקב היום` : "אין מעקבים פתוחים להיום"}
          </p>
        </div>
        <div className="row">
          <span className="xsmall subtle hide-mobile">עודכן {relTime(data.evaluatedAt)}</span>
          <IconButton icon="refresh" label="רענון" onClick={refresh} disabled={refreshing} className={refreshing ? "spin" : undefined} />
        </div>
      </div>

      {data.freshness.stale && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="warn" action={<Link href="/imports" className="btn sm">לעדכון</Link>}>
            נתוני המנויים שיובאו ישנים מהמותר
            {data.freshness.lastImportAt ? ` (עדכון אחרון ${relTime(data.freshness.lastImportAt)})` : ""}. כללי המעקב שתלויים בהם מושהים עד לעדכון.
          </Banner>
        </div>
      )}

      <div className="stats-3" style={{ marginBottom: 20 }}>
        <button className="stat" aria-pressed={view === "all"} onClick={() => setView("all")}>
          <div className="stat-value">{data.counts.needFollowup}</div>
          <div className="stat-label">זקוקים למעקב</div>
        </button>
        <button className="stat" aria-pressed={view === "overdue"} onClick={() => setView(view === "overdue" ? "all" : "overdue")}>
          <div className="stat-value" style={{ color: data.counts.overdue ? "var(--red)" : undefined }}>
            {data.counts.overdue}
          </div>
          <div className="stat-label">באיחור</div>
        </button>
        <button className="stat" aria-pressed={view === "ending"} onClick={() => setView(view === "ending" ? "all" : "ending")}>
          <div className="stat-value">{data.counts.endingSoon}</div>
          <div className="stat-label">מנויים מסתיימים</div>
        </button>
      </div>

      <div className="chips" style={{ marginBottom: 16 }} role="group" aria-label="סינון">
        <button className="chip" aria-pressed={owner === ""} onClick={() => setOwner("")}>
          כולם
        </button>
        <button className="chip" aria-pressed={owner === "me"} onClick={() => setOwner(owner === "me" ? "" : "me")}>
          שלי
        </button>
        <button className="chip" aria-pressed={owner === "none"} onClick={() => setOwner(owner === "none" ? "" : "none")}>
          ללא אחראי
        </button>
        {staff.length > 1 && (
          <label className="chip" aria-pressed={!!owner && owner !== "me" && owner !== "none"}>
            <Icon name="person" size={15} />
            <select value={owner && owner !== "me" && owner !== "none" ? owner : ""} onChange={(e) => setOwner(e.target.value)} aria-label="אחראי">
              <option value="">אחראי</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="chip" aria-pressed={!!rule}>
          <Icon name="filter" size={15} />
          <select value={rule} onChange={(e) => setRule(e.target.value)} aria-label="סיבה">
            <option value="">כל הסיבות</option>
            {rulesPresent.map((r) => (
              <option key={r} value={r}>
                {RULE_SHORT[r] ?? r}
              </option>
            ))}
          </select>
        </label>
      </div>

      {cards.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="checkCircle"
            title={data.cards.length ? "אין תוצאות לסינון הזה" : "הכל מטופל להיום"}
            text={data.cards.length ? "נסו לנקות את הסינון." : `הרשימה עודכנה ${relTime(data.evaluatedAt)}. כשמישהו יזדקק למעקב — הוא יופיע כאן.`}
            action={
              data.cards.length ? (
                <Button onClick={() => { setOwner(""); setRule(""); setView("all"); }}>ניקוי סינון</Button>
              ) : (
                <div className="row wrap" style={{ justifyContent: "center" }}>
                  <Link href="/contacts?new=1" className="btn primary">
                    הוספת לקוח
                  </Link>
                  {canSettings && (
                    <Link href="/settings?tab=rules" className="btn">
                      בדיקת כללי המעקב
                    </Link>
                  )}
                </div>
              )
            }
          />
        </div>
      ) : (
        <div className="stack-3">
          {cards.map((c, idx) => {
            const top = c.reasons[0];
            const others = c.reasons.slice(1);
            const lvl = level(c.priority);
            return (
              <article key={c.contactId} className={cx("fu-card", leaving.has(c.contactId) && "leaving")} style={{ animationDelay: `${Math.min(idx, 8) * 30}ms` }} aria-label={c.name}>
                <span className={cx("priority-bar", lvl)} title={LEVEL_LABEL[lvl]} aria-label={LEVEL_LABEL[lvl]} />
                <div className="grow stack-2" style={{ minWidth: 0 }}>
                  <div className="row between start" style={{ gap: 8 }}>
                    <Link href={`/contacts/${c.contactId}`} className="row" style={{ gap: 10, minWidth: 0 }}>
                      <Avatar name={c.name} size="sm" />
                      <div style={{ minWidth: 0 }}>
                        <div className="bold truncate" style={{ fontSize: 16 }}>
                          {c.name}
                        </div>
                        <div className="xsmall subtle truncate">
                          {STAGE_LABEL[c.stage]} {c.ownerName ? `· ${c.ownerName}` : "· ללא אחראי"}
                        </div>
                      </div>
                    </Link>
                    <span className={cx("badge", c.overdue ? "red" : "gray")} title={new Date(top.dueAt).toLocaleString("he-IL")}>
                      <Icon name="clock" size={13} />
                      {c.overdue ? `באיחור · ${relTime(c.dueAt)}` : top.kind === "task" ? relTime(top.dueAt) : "להיום"}
                    </span>
                  </div>

                  <div className="fu-reason">
                    <Icon name={RULE_ICON[top.rule] ?? "info"} size={16} />
                    <span className="bold" style={{ color: "var(--text)" }}>
                      {top.kind === "task" ? top.title || "משימת מעקב" : RULE_LABEL[top.rule]}
                    </span>
                  </div>
                  {top.kind === "rule" && factsLine(top.rule, top.facts) && <div className="small muted">{factsLine(top.rule, top.facts)}</div>}

                  {(others.length > 0 || c.lastContact) && (
                    <div className="row wrap" style={{ gap: 6 }}>
                      {others.map((r) => (
                        <Badge key={r.suggestionId ?? r.taskId} tone="gray">
                          + {r.kind === "task" ? r.title || "משימה" : RULE_SHORT[r.rule]}
                        </Badge>
                      ))}
                      {c.lastContact && (
                        <span className="xsmall subtle">
                          קשר אחרון {relTime(c.lastContact.at)}
                          {c.lastContact.outcome ? ` · ${OUTCOME_LABEL[c.lastContact.outcome] ?? ""}` : ""}
                        </span>
                      )}
                    </div>
                  )}

                  {c.guards.phoneInvalid && (
                    <div className="row xsmall" style={{ color: "var(--orange)", gap: 4 }}>
                      <Icon name="alert" size={14} /> חסר מספר טלפון תקין — אי אפשר לפתוח וואטסאפ עד לתיקון
                    </div>
                  )}

                  <div className="row wrap" style={{ gap: 8, marginTop: 4 }}>
                    {c.guards.phoneInvalid ? (
                      <Link href={`/contacts/${c.contactId}?edit=1`} className="btn primary sm">
                        <Icon name="edit" size={16} /> תיקון פרטים
                      </Link>
                    ) : canFollowup ? (
                      <Button
                        size="sm"
                        variant="primary"
                        icon="message"
                        onClick={() =>
                          setComposer({
                            contactId: c.contactId,
                            contactName: c.name,
                            rule: top.kind === "task" ? "R06" : top.rule,
                            suggestionId: top.suggestionId,
                            taskId: top.taskId,
                            taskTitle: top.kind === "task" ? top.title : null,
                            facts: top.facts,
                          })
                        }
                      >
                        {RULE_ACTION[top.kind === "task" ? "TASK" : top.rule]}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      icon="checkCircle"
                      onClick={() => setOutcome({ contactId: c.contactId, name: c.name, suggestionId: top.suggestionId, taskId: top.taskId, defaultChannel: "call" })}
                    >
                      השלמה
                    </Button>
                    <Menu
                      trigger={(p) => (
                        <button {...p} className="btn sm ghost" aria-label="דחייה">
                          <Icon name="snooze" size={16} /> <span className="hide-mobile">דחייה</span>
                        </button>
                      )}
                    >
                      <button onClick={() => snooze(top, c.contactId, tomorrowAt(9))}>
                        <Icon name="clock" size={17} /> מחר בבוקר
                      </button>
                      <button
                        onClick={() => {
                          const d = tomorrowAt(9);
                          d.setDate(d.getDate() + 2);
                          snooze(top, c.contactId, d);
                        }}
                      >
                        <Icon name="clock" size={17} /> בעוד 3 ימים
                      </button>
                      <button
                        onClick={() => {
                          const d = tomorrowAt(9);
                          d.setDate(d.getDate() + 6);
                          snooze(top, c.contactId, d);
                        }}
                      >
                        <Icon name="calendar" size={17} /> בעוד שבוע
                      </button>
                      <button onClick={() => setCustom({ reason: top, name: c.contactId })}>
                        <Icon name="edit" size={17} /> בחירת מועד…
                      </button>
                    </Menu>
                    <Menu
                      trigger={(p) => (
                        <button {...p} className="icon-btn sm" aria-label="פעולות נוספות" style={{ marginInlineStart: "auto" }}>
                          <Icon name="more" size={18} />
                        </button>
                      )}
                    >
                      <Link href={`/contacts/${c.contactId}`}>
                        <Icon name="person" size={17} /> פתיחת התיק
                      </Link>
                      <button onClick={() => setDismiss({ suggestionId: top.suggestionId, taskId: top.taskId, name: c.name })}>
                        <Icon name="xCircle" size={17} /> {top.kind === "task" ? "החרגת המשימה" : "החרגת הסיבה"}
                      </button>
                    </Menu>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {data.excluded.length > 0 && (
        <details className="card" style={{ marginTop: 24 }}>
          <summary className="card-pad row" style={{ cursor: "pointer", listStyle: "none", padding: "14px 18px" }}>
            <Icon name="info" size={18} />
            <span className="grow small">
              <span className="bold">{data.excluded.length} לא מופיעים ברשימה</span> <span className="muted">— למה?</span>
            </span>
            <Icon name="chevronDown" size={18} />
          </summary>
          <div className="list" style={{ border: 0, borderTop: "1px solid var(--line)", borderRadius: 0, boxShadow: "none" }}>
            {data.excluded.map((x) => (
              <div key={`${x.contactId}-${x.rule}`} className="list-item">
                <Link href={`/contacts/${x.contactId}`} className="grow" style={{ minWidth: 0 }}>
                  <div className="bold truncate">{x.name}</div>
                  <div className="xsmall subtle">
                    {RULE_SHORT[x.rule]} · {EXCLUDED_LABEL[x.reason] ?? x.reason}
                  </div>
                </Link>
                {x.reason !== "blocked" && (
                  <Button size="sm" variant="ghost" onClick={() => setOverride({ contactId: x.contactId, name: x.name })}>
                    לפנות בכל זאת
                  </Button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      <Composer target={composer} open={!!composer} onClose={() => setComposer(null)} onDone={() => composer && removeCard(composer.contactId)} />

      <Sheet open={!!outcome} onClose={() => setOutcome(null)} title={outcome ? `השלמת מעקב · ${outcome.name}` : ""}>
        {outcome && (
          <OutcomeForm
            target={outcome}
            onSaved={() => {
              toast("המעקב תועד", "success");
              const id = outcome.contactId;
              setOutcome(null);
              removeCard(id);
            }}
          />
        )}
      </Sheet>

      <DismissSheet
        target={dismiss}
        onClose={() => setDismiss(null)}
        onDone={(cid) => {
          setDismiss(null);
          toast("הוחרג מהרשימה", "success");
          if (cid) removeCard(cid);
          else refresh();
        }}
        cards={data.cards}
      />

      <CustomSnooze
        open={!!custom}
        onClose={() => setCustom(null)}
        onPick={(d) => {
          if (custom) snooze(custom.reason, custom.name, d);
          setCustom(null);
        }}
      />

      <OverrideSheet target={override} onClose={() => setOverride(null)} onDone={() => { setOverride(null); refresh(); }} />
    </div>
  );
}

function DismissSheet({ target, onClose, onDone, cards }: { target: { suggestionId?: string; taskId?: string; name: string } | null; onClose: () => void; onDone: (contactId?: string) => void; cards: Card[] }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contactId = cards.find((c) => c.reasons.some((r) => (target?.suggestionId && r.suggestionId === target.suggestionId) || (target?.taskId && r.taskId === target.taskId)))?.contactId;
  const save = async () => {
    if (!target) return;
    setSaving(true);
    setError(null);
    try {
      if (target.suggestionId) await api(`/api/suggestions/${target.suggestionId}/dismiss`, { body: { reason } });
      else if (target.taskId) {
        const t = await api<{ version: number }>(`/api/tasks/${target.taskId}`);
        await api(`/api/tasks/${target.taskId}`, { method: "PATCH", body: { action: "dismiss", version: t.version, dismiss_reason: reason } });
      }
      setReason("");
      onDone(contactId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet
      open={!!target}
      onClose={onClose}
      title="החרגה מהרשימה"
      subtitle={target?.name}
      footer={
        <>
          <Button onClick={onClose}>ביטול</Button>
          <Button variant="primary" loading={saving} disabled={!reason.trim()} onClick={save}>
            החרגה
          </Button>
        </>
      }
    >
      <div className="stack-3">
        <p className="muted small">החרגה אינה נחשבת יצירת קשר. הסיבה נשמרת כדי שיהיה ברור למה הלקוח לא מופיע.</p>
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="chips" style={{ marginInline: 0, paddingInline: 0, flexWrap: "wrap" }}>
          {["כבר דיברנו בטלפון", "טופל מחוץ למערכת", "לא רלוונטי כרגע", "נמצא/ת בחופשה"].map((r) => (
            <button key={r} type="button" className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
        <TextArea label="סיבה" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </div>
    </Sheet>
  );
}

function CustomSnooze({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (d: Date) => void }) {
  const [value, setValue] = useState(localInputValue(tomorrowAt(10)));
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="דחייה למועד אחר"
      footer={
        <>
          <Button onClick={onClose}>ביטול</Button>
          <Button variant="primary" onClick={() => onPick(new Date(value))} disabled={!value || new Date(value) <= new Date()}>
            דחייה
          </Button>
        </>
      }
    >
      <TextField label="מתי להזכיר?" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
    </Sheet>
  );
}

function OverrideSheet({ target, onClose, onDone }: { target: { contactId: string; name: string } | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!target) return;
    setSaving(true);
    try {
      await api("/api/tasks", { body: { contact_id: target.contactId, title: "מעקב חריג", due_at: new Date().toISOString(), reason } });
      toast("נוצרה משימה להיום", "success");
      setReason("");
      onDone();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet
      open={!!target}
      onClose={onClose}
      title="פנייה בכל זאת"
      subtitle={target?.name}
      footer={
        <>
          <Button onClick={onClose}>ביטול</Button>
          <Button variant="primary" loading={saving} disabled={!reason.trim()} onClick={save}>
            יצירת משימה להיום
          </Button>
        </>
      }
    >
      <div className="stack-3">
        <p className="small muted">פנו ללקוח הזה לאחרונה. אפשר לפנות שוב רק עם סיבה מתועדת.</p>
        <TextArea label="למה לפנות שוב?" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </div>
    </Sheet>
  );
}
