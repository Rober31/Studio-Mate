"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError, newKey } from "@/lib/api";
import { MEMBERSHIP_STATUS_LABEL, MEMBERSHIP_STATUS_TONE, PLAN_TYPE_LABEL } from "@/lib/i18n";
import { fmtDateTime, fmtYmd, relTime } from "@/lib/format";
import { Icon } from "../Icon";
import { Badge, Banner, Button, Checkbox, Dialog, IconButton, Sheet, Skeleton, TextArea, TextField, useToast } from "../ui";
import { MembershipSheet } from "./MembershipSheet";
import { addYmd } from "./dates";

type Detail = {
  membership: {
    id: string;
    contact_id: string;
    contact_name?: string;
    plan_name: string;
    plan_type: "period" | "punch" | "punch_period" | "trial";
    authority: "local" | "external";
    status: string;
    reasons: string[];
    balance: number | null;
    used: number;
    sessions_granted: number | null;
    reference: string | null;
    cancel_reason: string | null;
    source_updated_at: string | null;
    renewed_from: string | null;
    version: number;
    created_at: string;
  };
  dates: { start: string; end: string | null };
  pauses: { id: string; start: string; end: string; reason: string | null }[];
  ledger: { id: string; kind: string; delta: number; reason: string | null; created_at: string; actor: string | null; session_title: string | null }[];
  permissions: { manage: boolean; adjust: boolean };
  today: string;
  tz: string;
};

const KIND_LABEL: Record<string, string> = { grant: "הקצאה", deduction: "שיעור", reversal: "החזרה", adjustment: "התאמה ידנית" };
const KIND_ICON: Record<string, string> = { grant: "plus", deduction: "calendar", reversal: "refresh", adjustment: "edit" };

type Mode = null | "adjust" | "pause" | "cancel";

/** Membership details, balance ledger and controlled actions (MEM-02/03). */
export function MembershipDetailSheet({ membershipId, open, onClose, onChanged }: { membershipId: string | null; open: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [renewOpen, setRenewOpen] = useState(false);

  const load = useCallback(async () => {
    if (!membershipId) return;
    setError(null);
    try {
      setD(await api<Detail>(`/api/memberships/${membershipId}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [membershipId]);

  useEffect(() => {
    if (open && membershipId) {
      setD(null);
      setMode(null);
      load();
    }
  }, [open, membershipId, load]);

  const changed = async () => {
    setMode(null);
    await load();
    onChanged();
  };

  const m = d?.membership;
  const local = m?.authority === "local";
  const ended = m && (m.status === "cancelled" || m.status === "expired");
  const title = mode === "adjust" ? "התאמת יתרה" : mode === "pause" ? "הקפאת מנוי" : mode === "cancel" ? "ביטול מנוי" : m?.plan_name ?? "מנוי";

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={title}
        subtitle={m?.contact_name}
        headerExtra={mode ? <IconButton icon="back" label="חזרה" onClick={() => setMode(null)} /> : undefined}
      >
        {error && <Banner tone="danger">{error}</Banner>}
        {!d && !error && (
          <div className="stack-3">
            <Skeleton height={80} />
            <Skeleton height={140} />
          </div>
        )}
        {d && m && mode === "adjust" && <AdjustForm d={d} onDone={changed} />}
        {d && m && mode === "pause" && <PauseForm d={d} onDone={changed} />}
        {d && m && mode === "cancel" && <CancelForm d={d} onDone={changed} />}
        {d && m && !mode && (
          <div className="stack-4 fade-in">
            <div className="row wrap" style={{ gap: 6 }}>
              {m.reasons.map((r) => (
                <Badge key={r} tone={MEMBERSHIP_STATUS_TONE[r]} dot>
                  {MEMBERSHIP_STATUS_LABEL[r] ?? r}
                </Badge>
              ))}
              <Badge>{PLAN_TYPE_LABEL[m.plan_type]}</Badge>
              {!local && <Badge tone="blue">מנוהל במערכת חיצונית</Badge>}
            </div>

            {m.balance !== null && (
              <div className="grid-2">
                <div className="stat">
                  <div className="stat-value num" style={{ color: m.balance <= 0 ? "var(--red)" : m.balance <= 2 ? "var(--orange)" : undefined }}>
                    {m.balance}
                  </div>
                  <div className="stat-label">שיעורים שנשארו</div>
                </div>
                <div className="stat">
                  <div className="stat-value num">{m.used}</div>
                  <div className="stat-label">שיעורים שנוצלו</div>
                </div>
              </div>
            )}

            <dl className="kv card card-pad">
              <dt>לקוח/ה</dt>
              <dd>
                <Link href={`/contacts/${m.contact_id}`} style={{ color: "var(--accent)" }} className="bold">
                  {m.contact_name}
                </Link>
              </dd>
              <dt>התחלה</dt>
              <dd>{fmtYmd(d.dates.start)}</dd>
              <dt>סיום</dt>
              <dd>{d.dates.end ? `${fmtYmd(d.dates.end)} (כולל)` : "ללא תאריך סיום"}</dd>
              {m.reference && (
                <>
                  <dt>אסמכתה</dt>
                  <dd>{m.reference}</dd>
                </>
              )}
              {m.cancel_reason && (
                <>
                  <dt>סיבת ביטול</dt>
                  <dd>{m.cancel_reason}</dd>
                </>
              )}
              {!local && (
                <>
                  <dt>עדכון אחרון מהמקור</dt>
                  <dd>{m.source_updated_at ? relTime(m.source_updated_at) : "לא ידוע"}</dd>
                </>
              )}
            </dl>

            {!local && <Banner tone="info">המנוי מגיע ממערכת חיצונית (ייבוא). כדי למנוע סתירה בין המקורות, שינויים נעשים במקור ויתעדכנו בייבוא הבא.</Banner>}

            {d.pauses.length > 0 && (
              <div>
                <div className="section-label">הקפאות</div>
                <div className="list">
                  {d.pauses.map((p) => (
                    <div key={p.id} className="list-item small">
                      <Icon name="pause" size={16} />
                      <span className="grow">
                        {fmtYmd(p.start)} – {fmtYmd(p.end)}
                        {p.reason ? <span className="subtle"> · {p.reason}</span> : null}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {local && (d.permissions.manage || d.permissions.adjust) && (
              <div className="row wrap">
                {d.permissions.manage && (
                  <Button icon="refresh" variant="soft" onClick={() => setRenewOpen(true)}>
                    חידוש
                  </Button>
                )}
                {d.permissions.adjust && m.balance !== null && !ended && (
                  <Button icon="edit" onClick={() => setMode("adjust")}>
                    התאמת יתרה
                  </Button>
                )}
                {d.permissions.manage && !ended && (
                  <Button icon="pause" onClick={() => setMode("pause")}>
                    הקפאה
                  </Button>
                )}
                {d.permissions.manage && m.status !== "cancelled" && (
                  <Button icon="xCircle" variant="ghost" onClick={() => setMode("cancel")} style={{ color: "var(--red)" }}>
                    ביטול
                  </Button>
                )}
              </div>
            )}

            {d.ledger.length > 0 && (
              <div>
                <div className="section-label">יומן שיעורים</div>
                <div className="list">
                  {d.ledger.map((e) => (
                    <div key={e.id} className="list-item">
                      <span className="tl-icon" style={{ width: 30, height: 30 }}>
                        <Icon name={KIND_ICON[e.kind] ?? "info"} size={15} />
                      </span>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="small bold truncate">
                          {KIND_LABEL[e.kind] ?? e.kind}
                          {e.session_title ? ` · ${e.session_title}` : ""}
                        </div>
                        <div className="xsmall subtle truncate">
                          {fmtDateTime(e.created_at, d.tz)}
                          {e.actor ? ` · ${e.actor}` : ""}
                          {e.reason && e.kind !== "deduction" ? ` · ${e.reason}` : ""}
                        </div>
                      </div>
                      <span className="bold num ltr" style={{ color: e.delta > 0 ? "var(--green)" : "var(--text-2)" }}>
                        {e.delta > 0 ? `+${e.delta}` : e.delta}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Sheet>
      {m && (
        <MembershipSheet
          open={renewOpen}
          onClose={() => setRenewOpen(false)}
          contactId={m.contact_id}
          contactName={m.contact_name ?? ""}
          renewFrom={m.id}
          onDone={() => {
            toast("נוצר מנוי חדש", "success");
            onChanged();
            onClose();
          }}
        />
      )}
    </>
  );
}

function useSubmit() {
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const submit = async (fn: () => Promise<void>) => {
    setSaving(true);
    setErrors({});
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      setMessage(e instanceof ApiError && e.fields ? null : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return { saving, errors, message, submit };
}

function AdjustForm({ d, onDone }: { d: Detail; onDone: () => void }) {
  const toast = useToast();
  const before = d.membership.balance ?? 0;
  const [delta, setDelta] = useState(1);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const key = useRef(newKey());
  const s = useSubmit();
  const after = before + delta;
  const step = (n: number) => setDelta((v) => {
    const next = v + n;
    return next === 0 ? next + n : Math.max(next, -before);
  });
  return (
    <div className="stack-4">
      <p className="small muted">התאמה ידנית נרשמת ביומן השיעורים עם הסיבה ושם המבצע. היא לא מוחקת רישומים קודמים.</p>
      {s.message && <Banner tone="danger">{s.message}</Banner>}
      <div className="card card-pad col" style={{ alignItems: "center", gap: 12 }}>
        <div className="row" style={{ gap: 18 }}>
          <IconButton icon="plus" label="הוספת שיעור" onClick={() => step(1)} />
          <span className="num bold ltr" style={{ fontSize: 34, minWidth: 70, textAlign: "center", color: delta > 0 ? "var(--green)" : "var(--red)" }}>
            {delta > 0 ? `+${delta}` : delta}
          </span>
          <button type="button" className="icon-btn" aria-label="הורדת שיעור" title="הורדת שיעור" onClick={() => step(-1)} disabled={after <= 0 && delta < 0}>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
              <path d="M5 12h14" />
            </svg>
          </button>
        </div>
        <div className="small muted num">
          יתרה: {before} ← <span className="bold" style={{ color: "var(--text)" }}>{after}</span>
        </div>
      </div>
      {s.errors.delta && <Banner tone="danger">{s.errors.delta}</Banner>}
      <TextArea label="סיבה" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={s.errors.reason} placeholder="למשל: שיעור פיצוי על ביטול" />
      <Button variant="primary" block disabled={!reason.trim() || after < 0} onClick={() => setConfirm(true)}>
        המשך
      </Button>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="לאשר את ההתאמה?"
        actions={
          <>
            <Button onClick={() => setConfirm(false)}>ביטול</Button>
            <Button
              variant="primary"
              loading={s.saving}
              data-autofocus
              onClick={() =>
                s.submit(async () => {
                  await api(`/api/memberships/${d.membership.id}/adjustments`, { body: { delta, reason }, idempotencyKey: key.current });
                  setConfirm(false);
                  toast("היתרה עודכנה", "success");
                  onDone();
                })
              }
            >
              אישור
            </Button>
          </>
        }
      >
        היתרה תשתנה מ-{before} ל-{after} שיעורים.
      </Dialog>
    </div>
  );
}

function PauseForm({ d, onDone }: { d: Detail; onDone: () => void }) {
  const toast = useToast();
  const [start, setStart] = useState(d.today);
  const [end, setEnd] = useState(addYmd(d.today, 13));
  const [reason, setReason] = useState("");
  const [extend, setExtend] = useState(true);
  const s = useSubmit();
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
  return (
    <div className="stack-4">
      {s.message && <Banner tone="danger">{s.message}</Banner>}
      <div className="grid-2">
        <TextField label="מתאריך" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        <TextField label="עד תאריך (כולל)" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} error={s.errors.end_date} />
      </div>
      <TextArea label="סיבה" optional rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="למשל: חופשה, פציעה" />
      {d.dates.end && (
        <Checkbox checked={extend} onChange={setExtend}>
          להאריך את מועד הסיום בהתאם
          <span className="xsmall muted" style={{ display: "block" }}>
            {extend && days > 0 ? `הסיום יזוז מ-${fmtYmd(d.dates.end)} ל-${fmtYmd(addYmd(d.dates.end, days))}` : "מועד הסיום יישאר כפי שהוא"}
          </span>
        </Checkbox>
      )}
      <Banner tone="info">בזמן ההקפאה לא תהיה זכאות לשיעורים, ולא יוצגו תזכורות &quot;לא מגיע/ה&quot;.</Banner>
      <Button
        variant="primary"
        block
        loading={s.saving}
        disabled={days < 1}
        onClick={() =>
          s.submit(async () => {
            await api(`/api/memberships/${d.membership.id}/pause`, { body: { start_date: start, end_date: end, reason, extend } });
            toast("המנוי הוקפא", "success");
            onDone();
          })
        }
      >
        הקפאה ל-{days > 0 ? days : 0} ימים
      </Button>
    </div>
  );
}

function CancelForm({ d, onDone }: { d: Detail; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const s = useSubmit();
  return (
    <div className="stack-4">
      <Banner tone="warn">ביטול מסיים את הזכאות מעכשיו. הרישומים והיסטוריית השיעורים נשמרים.</Banner>
      {s.message && <Banner tone="danger">{s.message}</Banner>}
      <TextArea label="סיבת הביטול" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={s.errors.reason} />
      <Button variant="danger" block disabled={!reason.trim()} onClick={() => setConfirm(true)}>
        ביטול המנוי
      </Button>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="לבטל את המנוי?"
        actions={
          <>
            <Button onClick={() => setConfirm(false)}>חזרה</Button>
            <Button
              variant="danger"
              loading={s.saving}
              onClick={() =>
                s.submit(async () => {
                  await api(`/api/memberships/${d.membership.id}/cancel`, { body: { reason, version: d.membership.version } });
                  setConfirm(false);
                  toast("המנוי בוטל", "success");
                  onDone();
                })
              }
            >
              כן, לבטל
            </Button>
          </>
        }
      >
        {d.membership.plan_name} של {d.membership.contact_name} יבוטל.
      </Dialog>
    </div>
  );
}
