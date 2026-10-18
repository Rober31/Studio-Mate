"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { factChips, FACT_SOURCE, type FactsLike } from "@/lib/facts";
import { RULE_LABEL, RULE_ICON, WARNING_LABEL, INVALID_REASON_LABEL, OUTCOME_LABEL, LANG_LABEL, MEMBERSHIP_STATUS_LABEL } from "@/lib/i18n";
import { fmtPhone, relTime } from "@/lib/format";
import { Icon } from "../Icon";
import { Badge, Banner, Button, Segmented, Sheet, Skeleton, SuccessCheck, TextArea, useToast } from "../ui";
import { OutcomeForm } from "./OutcomeForm";

export type ComposerTarget = {
  contactId: string;
  contactName: string;
  rule: string; // R01..R07 | TASK | GENERAL
  suggestionId?: string | null;
  taskId?: string | null;
  taskTitle?: string | null;
  facts?: FactsLike;
};

type Draft = {
  id: string;
  text: string;
  generated_text: string;
  language: "he" | "ar" | "en";
  status: string;
  warnings: string[];
  generator: "ai" | "template";
  facts: FactsLike;
  version: number;
  invalid_reason: string | null;
};

type Brief = {
  contact: { id: string; display_name: string; phone_e164: string | null; phone_valid: number; preferred_language: string | null };
  memberships: { id: string; plan_name: string; status: string; balance: number | null }[];
  tasks: { id: string; title: string | null; reason_code: string; due_at: string; status: string }[];
  recent: { occurred_at: string; event_type: string; outcome: string | null; note: string | null; actor: string | null }[];
  guards: { blocked: boolean; blockReason: string | null; phoneInvalid: boolean; cooldownUntil: string | null; overLimit: boolean; recentContacts: number };
};

type Step = "compose" | "sent?" | "outcome" | "done";

const EVENT_LABEL: Record<string, string> = {
  wa_opened: "נפתחה הודעה",
  marked_sent: "נשלחה הודעה",
  outcome_recorded: "תועדה תוצאה",
  call: "שיחה",
  renewal: "חידוש מנוי",
  registration: "בקשת הרשמה",
};

/** S05 — reason & facts first, then an editable draft, WhatsApp handoff and the outcome. */
export function Composer({ target, open, onClose, onDone }: { target: ComposerTarget | null; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState("");
  const [lang, setLang] = useState<"he" | "ar" | "en">("he");
  const [tone, setTone] = useState<"warm" | "neutral" | "short">("warm");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<{ message: string; invalid?: boolean; fixPhone?: boolean; override?: boolean } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [step, setStep] = useState<Step>("compose");
  const [handing, setHanding] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [showContext, setShowContext] = useState(false);
  const loadedFor = useRef<string | null>(null);

  const reset = () => {
    setBrief(null);
    setDraft(null);
    setText("");
    setError(null);
    setStep("compose");
    setOverrideReason("");
    setSavedAt(null);
    setShowContext(false);
  };

  const generate = useCallback(
    async (opts: { language?: "he" | "ar" | "en"; tone?: "warm" | "neutral" | "short"; override?: string } = {}) => {
      if (!target) return;
      setGenerating(true);
      setError(null);
      try {
        const body = {
          language: opts.language,
          tone: opts.tone ?? tone,
          length: (opts.tone ?? tone) === "short" ? "short" : "normal",
          override_reason: opts.override || undefined,
        };
        const d = target.suggestionId
          ? await api<Draft>(`/api/suggestions/${target.suggestionId}/draft`, { body })
          : await api<Draft>("/api/drafts", { body: { ...body, contact_id: target.contactId, task_id: target.taskId ?? undefined } });
        setDraft(d);
        setText(d.text);
        setLang(d.language);
      } catch (e) {
        if (e instanceof ApiError) {
          setError({ message: e.message, override: !!e.details?.needsOverride, invalid: e.status === 409 });
        } else setError({ message: "משהו השתבש. נסו שוב." });
      } finally {
        setGenerating(false);
      }
    },
    [target, tone],
  );

  // Load context and prepare the first draft right away (fewest steps).
  useEffect(() => {
    if (!open || !target) return;
    const key = `${target.contactId}:${target.suggestionId ?? ""}:${target.taskId ?? ""}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    reset();
    api<Brief>(`/api/contacts/${target.contactId}/brief`)
      .then((b) => {
        setBrief(b);
        if (b.guards.blocked) return;
        if (!target.taskId && (b.guards.cooldownUntil || b.guards.overLimit)) {
          setError({ message: "פנו ללקוח הזה לאחרונה. כדי להכין הודעה בכל זאת, כתבו סיבה קצרה.", override: true });
          return;
        }
        generate({});
      })
      .catch((e) => setError({ message: (e as Error).message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);

  useEffect(() => {
    if (!open) loadedFor.current = null;
  }, [open]);

  const saveEdit = async () => {
    if (!draft || text.trim() === draft.text) return;
    try {
      const d = await api<Draft>(`/api/drafts/${draft.id}`, { method: "PATCH", body: { text, version: draft.version } });
      setDraft(d);
      setSavedAt(Date.now());
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, invalid: err.status === 409 });
    }
  };

  const openWhatsApp = async () => {
    if (!draft) return;
    // Open the window synchronously (popup blockers), then point it at wa.me.
    const win = typeof window !== "undefined" ? window.open("", "_blank") : null;
    setHanding(true);
    setError(null);
    try {
      const res = await api<{ url: string; draft: Draft }>(`/api/drafts/${draft.id}/handoff`, { body: { text } });
      setDraft(res.draft);
      if (win) win.location.href = res.url;
      else window.location.href = res.url;
      setStep("sent?");
    } catch (e) {
      win?.close();
      const err = e as ApiError;
      setError({ message: err.message, invalid: err.status === 409, fixPhone: !!err.details?.fixPhone });
    } finally {
      setHanding(false);
    }
  };

  const markSent = async () => {
    if (!draft) return;
    try {
      await api(`/api/drafts/${draft.id}/sent`, { method: "POST" });
      setStep("outcome");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${label} הועתק`, "success");
    } catch {
      toast("לא הצלחנו להעתיק. סמנו את הטקסט והעתיקו ידנית.", "error");
    }
  };

  const finish = () => {
    setStep("done");
    setTimeout(() => {
      onDone();
      onClose();
    }, 900);
  };

  if (!target) return null;
  const chips = factChips(draft?.facts ?? target.facts);
  const reasonLabel = target.taskTitle || RULE_LABEL[target.rule] || RULE_LABEL.GENERAL;
  const blocked = brief?.guards.blocked;
  const charCount = text.length;

  const footer =
    step === "compose" && draft && !blocked ? (
      <>
        <Button icon="copy" onClick={() => copy(text, "הטקסט")} className="hide-mobile">
          העתקה
        </Button>
        <Button variant="whatsapp" icon="whatsapp" loading={handing} onClick={openWhatsApp} disabled={!text.trim() || generating}>
          פתיחה בוואטסאפ
        </Button>
      </>
    ) : step === "sent?" ? (
      <>
        <Button onClick={() => setStep("outcome")}>לא נשלחה</Button>
        <Button variant="primary" icon="check" onClick={markSent}>
          כן, שלחתי
        </Button>
      </>
    ) : undefined;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title={step === "outcome" ? "מה קרה?" : step === "sent?" ? "שלחת את ההודעה?" : `הודעה ל${target.contactName}`}
      subtitle={brief?.contact.phone_e164 ? <span className="ltr">{fmtPhone(brief.contact.phone_e164)}</span> : undefined}
      footer={footer}
      headerExtra={
        <Link href={`/contacts/${target.contactId}`} className="btn ghost sm hide-mobile">
          לתיק
        </Link>
      }
    >
      {step === "done" ? (
        <div className="col" style={{ alignItems: "center", padding: "48px 0", gap: 14 }}>
          <SuccessCheck />
          <div className="bold" style={{ fontSize: 18 }}>
            המעקב תועד
          </div>
        </div>
      ) : step === "outcome" ? (
        <OutcomeForm
          target={{
            contactId: target.contactId,
            suggestionId: target.suggestionId,
            draftId: draft?.id,
            taskId: target.taskId,
            defaultChannel: "whatsapp",
            memberships: brief?.memberships,
          }}
          onSaved={finish}
        />
      ) : step === "sent?" ? (
        <div className="stack-4">
          <p className="muted">וואטסאפ נפתח בחלון חדש עם ההודעה מוכנה. אחרי ששלחת — חזרו לכאן ואשרו.</p>
          <div className="bubble">{text}</div>
          <Banner tone="info">
            פתיחת וואטסאפ לא מוכיחה שההודעה נשלחה. רק אחרי אישור שלך המעקב ייספר כ&quot;נשלח&quot;.
          </Banner>
          <div className="row wrap">
            <Button size="sm" icon="copy" onClick={() => copy(text, "הטקסט")}>
              העתקת הטקסט
            </Button>
            {brief?.contact.phone_e164 && (
              <Button size="sm" icon="phone" onClick={() => copy(brief.contact.phone_e164!, "המספר")}>
                העתקת המספר
              </Button>
            )}
            <Button size="sm" variant="ghost" icon="whatsapp" onClick={openWhatsApp}>
              לפתוח שוב
            </Button>
          </div>
        </div>
      ) : (
        <div className="stack-4">
          {/* Why + facts before the text (AI-03) */}
          <div className="card card-pad" style={{ padding: 14, background: "var(--surface-2)" }}>
            <div className="row start" style={{ gap: 10 }}>
              <span className="tl-icon" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                <Icon name={RULE_ICON[target.rule] ?? "message"} size={17} />
              </span>
              <div className="grow">
                <div className="bold">{reasonLabel}</div>
                <div className="xsmall subtle">מקור: {FACT_SOURCE[target.rule] ?? FACT_SOURCE.GENERAL}</div>
              </div>
            </div>
            {chips.length > 0 && (
              <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
                {chips.map((c) => (
                  <span key={c.label} className="fact">
                    <span className="subtle">{c.label}</span> <span className="bold">{c.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {brief && (brief.recent.length > 0 || brief.tasks.length > 0) && (
            <div>
              <button type="button" className="row small muted" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => setShowContext((s) => !s)} aria-expanded={showContext}>
                <Icon name="history" size={16} />
                <span>
                  פעולות אחרונות ומשימות פתוחות ({brief.recent.length + brief.tasks.length})
                </span>
                <Icon name="chevronDown" size={16} style={{ transform: showContext ? "rotate(180deg)" : undefined, transition: "transform 200ms" }} />
              </button>
              {showContext && (
                <div className="list fade-in" style={{ marginTop: 8 }}>
                  {brief.tasks.map((t) => (
                    <div key={t.id} className="list-item small">
                      <Icon name="tasks" size={16} />
                      <span className="grow">{t.title || RULE_LABEL[t.reason_code] || "משימה"}</span>
                      <span className="subtle">{relTime(t.due_at)}</span>
                    </div>
                  ))}
                  {brief.recent.map((r, i) => (
                    <div key={i} className="list-item small">
                      <Icon name="message" size={16} />
                      <span className="grow">
                        {EVENT_LABEL[r.event_type] ?? r.event_type}
                        {r.outcome ? ` · ${OUTCOME_LABEL[r.outcome] ?? r.outcome}` : ""}
                        {r.actor ? <span className="subtle"> · {r.actor}</span> : null}
                      </span>
                      <span className="subtle">{relTime(r.occurred_at)}</span>
                    </div>
                  ))}
                  {brief.memberships.map((m) => (
                    <div key={m.id} className="list-item small">
                      <Icon name="card" size={16} />
                      <span className="grow">{m.plan_name}</span>
                      <Badge>{MEMBERSHIP_STATUS_LABEL[m.status] ?? m.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {blocked && (
            <Banner tone="danger" icon="ban">
              הלקוח ביקש שלא ניצור איתו קשר{brief?.guards.blockReason ? ` (${brief.guards.blockReason})` : ""}. אי אפשר להכין הודעה.
            </Banner>
          )}

          {error && (
            <Banner
              tone={error.invalid ? "warn" : "danger"}
              action={
                error.invalid ? (
                  <Button size="sm" onClick={() => generate({ language: lang })}>
                    הכנה מחדש
                  </Button>
                ) : error.fixPhone ? (
                  <Link href={`/contacts/${target.contactId}?edit=1`} className="btn sm">
                    לתיקון
                  </Link>
                ) : undefined
              }
            >
              {error.message}
              {draft?.invalid_reason && INVALID_REASON_LABEL[draft.invalid_reason] ? ` (${INVALID_REASON_LABEL[draft.invalid_reason]})` : ""}
            </Banner>
          )}

          {error?.override && (
            <div className="stack-2 fade-in">
              <TextArea label="למה בכל זאת לפנות?" rows={2} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="למשל: הלקוח ביקש שנחזור אליו היום" />
              <Button variant="primary" disabled={!overrideReason.trim()} loading={generating} onClick={() => generate({ override: overrideReason })}>
                הכנת הודעה
              </Button>
            </div>
          )}

          {generating && !draft && (
            <div className="stack-2" aria-live="polite" aria-busy="true">
              <div className="row small muted">
                <Icon name="sparkle" size={16} /> מכינים הצעה…
              </div>
              <Skeleton height={18} />
              <Skeleton height={18} width="85%" />
              <Skeleton height={18} width="60%" />
            </div>
          )}

          {draft && !blocked && (
            <div className="stack-3 fade-in">
              <div className="row between wrap" style={{ gap: 8 }}>
                <Segmented
                  label="שפת ההודעה"
                  value={lang}
                  onChange={(v) => {
                    setLang(v);
                    generate({ language: v });
                  }}
                  options={(["he", "ar", "en"] as const).map((l) => ({ value: l, label: LANG_LABEL[l] }))}
                />
                <Segmented
                  label="סגנון"
                  value={tone}
                  onChange={(v) => {
                    setTone(v);
                    generate({ language: lang, tone: v });
                  }}
                  options={[
                    { value: "warm", label: "חם" },
                    { value: "neutral", label: "עניני" },
                    { value: "short", label: "קצר" },
                  ]}
                />
              </div>
              <div style={{ position: "relative" }}>
                <textarea
                  className="textarea"
                  dir={lang === "en" ? "ltr" : "rtl"}
                  rows={6}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onBlur={saveEdit}
                  aria-label="טקסט ההודעה"
                  style={{ fontSize: 16, minHeight: 150, opacity: generating ? 0.5 : 1 }}
                  disabled={generating}
                />
              </div>
              <div className="row between xsmall subtle">
                <span className="row" style={{ gap: 6 }}>
                  <Icon name={draft.generator === "ai" ? "sparkle" : "note"} size={14} />
                  {draft.generator === "ai" ? "הצעה של עוזר הניסוח — בדקו לפני שליחה" : "תבנית קבועה — אפשר לערוך"}
                  {savedAt && <span>· נשמר</span>}
                </span>
                <span className="num" style={{ color: charCount > 600 ? "var(--red)" : undefined }}>
                  {charCount}
                </span>
              </div>
              {draft.warnings.length > 0 && (
                <div className="stack-2">
                  {draft.warnings.map((w) => (
                    <Banner key={w} tone={w === "phone_invalid" ? "warn" : "info"}>
                      {WARNING_LABEL[w] ?? w}
                    </Banner>
                  ))}
                </div>
              )}
              <div className="row wrap">
                <Button size="sm" variant="ghost" icon="refresh" loading={generating} onClick={() => generate({ language: lang })}>
                  ניסוח מחדש
                </Button>
                <Button size="sm" variant="ghost" icon="copy" onClick={() => copy(text, "הטקסט")} className="hide-desktop">
                  העתקה
                </Button>
                <Button size="sm" variant="ghost" icon="checkCircle" onClick={() => setStep("outcome")}>
                  תיעוד בלי הודעה
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
