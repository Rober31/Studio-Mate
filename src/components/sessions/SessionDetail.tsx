"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError, newKey } from "@/lib/api";
import { ATTENDANCE_STATUS_LABEL, CHANNEL_LABEL, SESSION_STATUS_LABEL, PLAN_TYPE_LABEL } from "@/lib/i18n";
import { fmtDateLong, fmtTime, fmtYmd } from "@/lib/format";
import { Icon } from "../Icon";
import { Avatar, Badge, Banner, Button, EmptyState, Menu, SearchInput, Sheet, SuccessCheck, TextArea, useConfirm, useToast } from "../ui";
import { SessionFormSheet, type SessionItem } from "./SessionForm";
import "@/app/sessions.css";

type RosterRow = {
  id: string;
  contact_id: string;
  contact_name: string;
  membership_id: string | null;
  plan_name: string | null;
  status: "present" | "reversed" | "pending_reconciliation";
  channel: string;
  checked_in_at: string;
  actor_name: string | null;
  reversal_reason: string | null;
  version: number;
  deducted: number;
};

type Data = { session: SessionItem; roster: RosterRow[] };

const STATUS_TONE: Record<string, "green" | "blue" | "gray" | "red"> = { scheduled: "blue", open: "green", completed: "gray", cancelled: "red" };

export function SessionDetail({
  initial,
  window: win,
  tz,
  staff,
  perms,
}: {
  initial: Data;
  window: { opensAt: string; closesAt: string };
  tz: string;
  staff: { id: string; name: string }[];
  perms: { manage: boolean; correct: boolean; export: boolean; contacts: boolean };
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<Data>(initial);
  const [checkin, setCheckin] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reversing, setReversing] = useState<RosterRow | null>(null);
  const s = data.session;

  const reload = useCallback(async () => {
    try {
      const d = await api<{ session: SessionItem; roster: RosterRow[] }>(`/api/sessions/${s.id}/roster`);
      setData({ session: d.session, roster: d.roster });
    } catch {
      /* keep current view */
    }
  }, [s.id]);

  useEffect(() => setData(initial), [initial]);

  // Live roster while the class is open (QR check-ins arrive from members' phones).
  useEffect(() => {
    if (s.status !== "open") return;
    const t = setInterval(reload, 8000);
    return () => clearInterval(t);
  }, [s.status, reload]);

  const toggleOpen = async (open: boolean) => {
    try {
      await api(`/api/sessions/${s.id}/open`, { body: { open } });
      toast(open ? "הרישום נפתח" : "הרישום נסגר", "success");
      router.refresh();
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const present = data.roster.filter((r) => r.status !== "reversed");
  const reversed = data.roster.filter((r) => r.status === "reversed");
  const cancelled = s.status === "cancelled";
  const ended = s.status === "completed";
  const exportFrom = new Date(Date.parse(s.start_at) - 60_000).toISOString();
  const exportTo = new Date(Date.parse(s.end_at) + 60_000).toISOString();

  return (
    <div className="page narrow">
      <Link href="/sessions" className="row small muted" style={{ marginBottom: 12, width: "fit-content" }}>
        <Icon name="back" size={16} /> כל השיעורים
      </Link>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="session-hero">
          <div style={{ minWidth: 0 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <h1 style={{ fontSize: 26, textDecoration: cancelled ? "line-through" : undefined }}>{s.title}</h1>
              <Badge tone={STATUS_TONE[s.status]} dot={s.status === "open"}>
                {SESSION_STATUS_LABEL[s.status]}
              </Badge>
            </div>
            <div className="session-meta">
              <span>
                <Icon name="calendar" size={15} /> {fmtDateLong(s.start_at, tz)}
              </span>
              <span className="num">
                <Icon name="clock" size={15} /> {fmtTime(s.start_at, tz)}–{fmtTime(s.end_at, tz)}
              </span>
              <span>
                <Icon name="person" size={15} /> {s.trainer_name ?? "ללא מדריך/ה"}
              </span>
            </div>
          </div>
          {(perms.manage || perms.export) && !cancelled && (
            <Menu
              trigger={(p) => (
                <button {...p} className="icon-btn" aria-label="פעולות לשיעור">
                  <Icon name="more" size={20} />
                </button>
              )}
            >
              {perms.manage && (
                <button onClick={() => setEditing(true)}>
                  <Icon name="edit" size={17} /> עריכת השיעור
                </button>
              )}
              {perms.export && (
                <a href={`/api/sessions/export?from=${encodeURIComponent(exportFrom)}&to=${encodeURIComponent(exportTo)}&session_id=${s.id}`}>
                  <Icon name="download" size={17} /> ייצוא רשימת נוכחות
                </a>
              )}
              {perms.manage && (
                <>
                  <hr />
                  <button className="danger" onClick={() => setCancelling(true)}>
                    <Icon name="xCircle" size={17} /> ביטול השיעור
                  </button>
                </>
              )}
            </Menu>
          )}
        </div>

        {cancelled ? (
          <div style={{ marginTop: 16 }}>
            <Banner tone="danger" icon="xCircle">
              השיעור בוטל{s.cancel_reason ? `: ${s.cancel_reason}` : ""}. הנוכחות שנרשמה בוטלה והשיעורים הוחזרו ליתרה.
            </Banner>
          </div>
        ) : (
          <div className="row wrap" style={{ marginTop: 18, gap: 8 }}>
            {!ended && (
              <Link href={`/display/sessions/${s.id}`} className="btn primary" target="_blank" rel="noopener">
                <Icon name="qr" size={18} /> הצגת QR לנוכחות
              </Link>
            )}
            <Button icon="user_plus" onClick={() => setCheckin(true)}>
              רישום ידני
            </Button>
            {s.status === "open" ? (
              <Button variant="ghost" icon="pause" onClick={() => toggleOpen(false)}>
                סגירת הרישום
              </Button>
            ) : s.status === "scheduled" ? (
              <Button variant="ghost" icon="play" onClick={() => toggleOpen(true)}>
                פתיחה לרישום
              </Button>
            ) : null}
          </div>
        )}
        {!cancelled && !ended && (
          <p className="xsmall subtle" style={{ marginTop: 12 }}>
            סריקה עצמית אפשרית מ-{fmtTime(win.opensAt, tz)} עד {fmtTime(win.closesAt, tz)}. אחרי זה — רישום ידני בלבד.
          </p>
        )}
      </div>

      <div className="row between" style={{ marginBottom: 10 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          נוכחים <span className="muted num">({present.length})</span>
        </h2>
        {s.status === "open" && (
          <span className="xsmall subtle row" style={{ gap: 4 }}>
            <Icon name="refresh" size={13} /> מתעדכן אוטומטית
          </span>
        )}
      </div>

      {present.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="people"
            title="עוד אין נוכחים"
            text={cancelled ? "השיעור בוטל." : "כשמתאמנים יסרקו את הקוד או שתרשמו אותם ידנית — הם יופיעו כאן."}
            action={!cancelled ? <Button onClick={() => setCheckin(true)}>רישום ידני</Button> : undefined}
          />
        </div>
      ) : (
        <div className="list">
          {present.map((r) => (
            <RosterItem key={r.id} r={r} tz={tz} canCorrect={perms.correct && !cancelled} canOpen={perms.contacts} onReverse={() => setReversing(r)} />
          ))}
        </div>
      )}

      {reversed.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary className="row small muted" style={{ cursor: "pointer", listStyle: "none" }}>
            <Icon name="history" size={16} /> נוכחות שבוטלה ({reversed.length}) <Icon name="chevronDown" size={16} />
          </summary>
          <div className="list" style={{ marginTop: 8 }}>
            {reversed.map((r) => (
              <RosterItem key={r.id} r={r} tz={tz} canCorrect={false} canOpen={perms.contacts} onReverse={() => {}} />
            ))}
          </div>
        </details>
      )}

      <p className="xsmall subtle" style={{ marginTop: 16 }}>
        הרשימה מציגה רק את מי שנרשם/ה. בלי רשימת הזמנות מהימנה לא מסמנים &quot;נעדר/ת&quot;.
      </p>

      <CheckinSheet
        open={checkin}
        onClose={() => setCheckin(false)}
        sessionId={s.id}
        late={ended}
        onDone={() => {
          reload();
          router.refresh();
        }}
      />
      <ReverseSheet
        row={reversing}
        onClose={() => setReversing(null)}
        onDone={() => {
          setReversing(null);
          toast("הנוכחות בוטלה", "success");
          reload();
        }}
      />
      <CancelSheet
        open={cancelling}
        session={s}
        presentCount={present.length}
        deductedCount={present.filter((r) => r.deducted).length}
        onClose={() => setCancelling(false)}
        onDone={async () => {
          setCancelling(false);
          toast("השיעור בוטל", "success");
          router.refresh();
          reload();
        }}
        confirm={confirm}
      />
      <SessionFormSheet open={editing} onClose={() => { setEditing(false); reload(); }} session={s} defaultDate="" tz={tz} staff={staff} />
    </div>
  );
}

function RosterItem({ r, tz, canCorrect, canOpen, onReverse }: { r: RosterRow; tz: string; canCorrect: boolean; canOpen: boolean; onReverse: () => void }) {
  const name = (
    <span className="bold truncate" style={{ display: "block", textDecoration: r.status === "reversed" ? "line-through" : undefined }}>
      {r.contact_name}
    </span>
  );
  return (
    <div className="list-item">
      <Avatar name={r.contact_name} size="sm" />
      <div className="grow" style={{ minWidth: 0 }}>
        {canOpen ? <Link href={`/contacts/${r.contact_id}`}>{name}</Link> : name}
        <div className="xsmall subtle truncate">
          {r.plan_name ?? "ללא מנוי"} · {CHANNEL_LABEL[r.channel] ?? r.channel} · <span className="num">{fmtTime(r.checked_in_at, tz)}</span>
          {r.actor_name ? ` · ${r.actor_name}` : ""}
          {r.status === "reversed" && r.reversal_reason ? ` · ${r.reversal_reason}` : ""}
        </div>
      </div>
      {r.status === "pending_reconciliation" && <Badge tone="orange">{ATTENDANCE_STATUS_LABEL[r.status]}</Badge>}
      {r.deducted ? (
        <span className="badge" title="ירד שיעור מהיתרה">
          −1
        </span>
      ) : null}
      {canCorrect && r.status !== "reversed" && (
        <Menu
          trigger={(p) => (
            <button {...p} className="icon-btn sm" aria-label={`פעולות עבור ${r.contact_name}`}>
              <Icon name="more" size={18} />
            </button>
          )}
        >
          <button className="danger" onClick={onReverse}>
            <Icon name="xCircle" size={17} /> ביטול נוכחות
          </button>
        </Menu>
      )}
    </div>
  );
}

type Candidate = {
  id: string;
  display_name: string;
  attendance_status: string | null;
  memberships: { id: string; plan_name: string; plan_type: string; balance: number | null; authority: string; ends_at: string | null }[];
};

function CheckinSheet({ open, onClose, sessionId, late, onDone }: { open: boolean; onClose: () => void; sessionId: string; late: boolean; onDone: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [membership, setMembership] = useState<string>("");
  const [lateReason, setLateReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const key = useRef<string>(newKey());

  useEffect(() => {
    if (!open) return;
    setQ("");
    setResults(null);
    setPicked(null);
    setMembership("");
    setLateReason("");
    setError(null);
    setDone(null);
    key.current = newKey();
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setResults(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await api<Candidate[]>(`/api/sessions/${sessionId}/candidates?q=${encodeURIComponent(q)}`, { signal: ctrl.signal }));
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open, sessionId]);

  const pick = (c: Candidate) => {
    setPicked(c);
    setError(null);
    key.current = newKey();
    setMembership(c.memberships.length === 1 ? c.memberships[0].id : c.memberships.length === 0 ? "none" : "");
  };

  const save = async () => {
    if (!picked) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ already_recorded: boolean }>(`/api/sessions/${sessionId}/checkins`, {
        idempotencyKey: key.current,
        body: {
          contact_id: picked.id,
          membership_id: membership && membership !== "none" ? membership : null,
          no_membership: membership === "none",
          late_reason: late ? lateReason : undefined,
        },
      });
      setDone(res.already_recorded ? `${picked.display_name} כבר רשום/ה בשיעור` : `${picked.display_name} נרשם/ה`);
      onDone();
      setTimeout(() => {
        setPicked(null);
        setQ("");
        setDone(null);
        key.current = newKey();
      }, 1100);
    } catch (e) {
      const err = e as ApiError;
      setError(err.fields ? Object.values(err.fields)[0] : err.message);
      if (err.status !== 0) key.current = newKey();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="רישום נוכחות ידני"
      footer={
        picked && !done ? (
          <>
            <Button onClick={() => setPicked(null)}>חזרה</Button>
            <Button variant="primary" loading={saving} onClick={save} disabled={!membership || (late && !lateReason.trim())}>
              רישום נוכחות
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>סיום</Button>
        )
      }
    >
      {done ? (
        <div className="col" style={{ alignItems: "center", gap: 12, padding: "40px 0" }}>
          <SuccessCheck size={64} />
          <div className="bold">{done}</div>
        </div>
      ) : picked ? (
        <div className="stack-4">
          <div className="row" style={{ gap: 10 }}>
            <Avatar name={picked.display_name} />
            <div className="bold" style={{ fontSize: 18 }}>
              {picked.display_name}
            </div>
          </div>
          {error && <Banner tone="danger">{error}</Banner>}
          {picked.attendance_status && picked.attendance_status !== "reversed" && <Banner tone="info">כבר רשום/ה בשיעור הזה. רישום נוסף לא יוריד שיעור שוב.</Banner>}
          <div>
            <div className="field-label" style={{ marginBottom: 8 }}>
              לפי איזה מנוי?
            </div>
            <div role="radiogroup" className="radio-cards">
              {picked.memberships.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={membership === m.id} className="radio-card" onClick={() => setMembership(m.id)}>
                  <span className="radio-dot" />
                  <span className="grow">
                    <span className="bold">{m.plan_name}</span>
                    <span className="xsmall muted" style={{ display: "block" }}>
                      {PLAN_TYPE_LABEL[m.plan_type] ?? m.plan_type}
                      {m.balance !== null ? ` · יתרה ${m.balance}` : ""}
                      {m.ends_at ? ` · עד ${fmtYmd(new Date(Date.parse(m.ends_at) - 1).toISOString().slice(0, 10))}` : ""}
                      {m.authority === "external" ? " · מנוהל באפליקציה חיצונית — ימתין לאישור" : ""}
                    </span>
                  </span>
                </button>
              ))}
              <button type="button" role="radio" aria-checked={membership === "none"} className="radio-card" onClick={() => setMembership("none")}>
                <span className="radio-dot" />
                <span className="grow">
                  <span className="bold">ללא מנוי</span>
                  <span className="xsmall muted" style={{ display: "block" }}>
                    שיעור ניסיון או חד-פעמי · לא יורד שיעור
                  </span>
                </span>
              </button>
            </div>
            {picked.memberships.length === 0 && (
              <p className="xsmall subtle" style={{ marginTop: 8 }}>
                אין מנוי בתוקף. אפשר לרשום כשיעור ניסיון או לפתוח מנוי בתיק הלקוח.
              </p>
            )}
          </div>
          {late && <TextArea label="סיבה לרישום מאוחר" rows={2} value={lateReason} onChange={(e) => setLateReason(e.target.value)} hint="השיעור כבר הסתיים. הסיבה נשמרת ביומן." />}
        </div>
      ) : (
        <div className="stack-3">
          <SearchInput value={q} onChange={setQ} placeholder="חיפוש לפי שם או טלפון" autoFocus />
          {error && <Banner tone="danger">{error}</Banner>}
          {q.trim().length < 2 ? (
            <p className="small muted">הקלידו לפחות 2 אותיות או ספרות.</p>
          ) : searching && !results ? (
            <div className="row small muted">
              <span className="spinner" /> מחפשים…
            </div>
          ) : results && results.length === 0 ? (
            <EmptyState icon="search" title="לא נמצאו לקוחות" text="בדקו את האיות, או חפשו לפי מספר טלפון." />
          ) : (
            <div className="list">
              {results?.map((c) => (
                <button key={c.id} className="candidate" onClick={() => pick(c)} disabled={!!c.attendance_status && c.attendance_status !== "reversed"}>
                  <Avatar name={c.display_name} size="sm" />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="bold truncate" style={{ display: "block" }}>
                      {c.display_name}
                    </span>
                    <span className="xsmall subtle">
                      {c.attendance_status === "reversed"
                        ? "נוכחות קודמת בוטלה"
                        : c.attendance_status
                          ? "כבר רשום/ה בשיעור"
                          : c.memberships.length
                            ? c.memberships.map((m) => m.plan_name + (m.balance !== null ? ` (${m.balance})` : "")).join(" · ")
                            : "אין מנוי בתוקף"}
                    </span>
                  </span>
                  {c.attendance_status && c.attendance_status !== "reversed" ? <Icon name="checkCircle" size={18} /> : <Icon name="chevron" size={18} className="list-chevron" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

function ReverseSheet({ row, onClose, onDone }: { row: RosterRow | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setReason("");
    setError(null);
  }, [row]);
  const save = async () => {
    if (!row) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/api/attendance/${row.id}/reversals`, { body: { reason, version: row.version } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet
      open={!!row}
      onClose={onClose}
      title="ביטול נוכחות"
      subtitle={row?.contact_name}
      footer={
        <>
          <Button onClick={onClose}>חזרה</Button>
          <Button variant="danger" loading={saving} disabled={!reason.trim()} onClick={save}>
            ביטול הנוכחות
          </Button>
        </>
      }
    >
      <div className="stack-3">
        {row?.deducted ? <Banner tone="info">השיעור יוחזר ליתרה של המנוי ({row.plan_name}). ההחזרה מתבצעת פעם אחת בלבד.</Banner> : null}
        {row?.status === "pending_reconciliation" && <Banner tone="warn">המנוי מנוהל באפליקציה חיצונית. יש לעדכן את הביטול גם שם.</Banner>}
        <p className="small muted">הרשומה לא נמחקת — היא מסומנת כמבוטלת ונשמרת ביומן עם הסיבה.</p>
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="row wrap" style={{ gap: 6 }}>
          {["נרשם/ה בטעות", "לא הגיע/ה בפועל", "נרשם/ה לשיעור הלא נכון"].map((r) => (
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

function CancelSheet({
  open,
  session,
  presentCount,
  deductedCount,
  onClose,
  onDone,
  confirm,
}: {
  open: boolean;
  session: SessionItem;
  presentCount: number;
  deductedCount: number;
  onClose: () => void;
  onDone: () => void;
  confirm: ReturnType<typeof useConfirm>;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);
  const save = async () => {
    const ok = await confirm({
      title: "לבטל את השיעור?",
      body: presentCount ? `${presentCount} רישומי נוכחות יבוטלו${deductedCount ? ` ו-${deductedCount} שיעורים יוחזרו ליתרה` : ""}. קוד ה-QR ייסגר.` : "קוד ה-QR ייסגר.",
      confirm: "ביטול השיעור",
      cancel: "חזרה",
      danger: true,
    });
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/api/sessions/${session.id}/cancel`, { body: { reason, version: session.version } });
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
      title="ביטול שיעור"
      subtitle={session.title}
      footer={
        <>
          <Button onClick={onClose}>חזרה</Button>
          <Button variant="danger" loading={saving} disabled={!reason.trim()} onClick={save}>
            המשך
          </Button>
        </>
      }
    >
      <div className="stack-3">
        <p className="small muted">
          ביטול סוגר את קוד ה-QR, מבטל את הנוכחות שנרשמה ומחזיר ליתרה שיעורים שירדו מכרטיסיות. הכל נשמר ביומן.
        </p>
        {error && <Banner tone="danger">{error}</Banner>}
        <TextArea label="סיבת הביטול" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="למשל: המדריכה חולה" autoFocus />
      </div>
    </Sheet>
  );
}
