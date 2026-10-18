"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError, newKey } from "@/lib/api";
import { PLAN_TYPE_LABEL } from "@/lib/i18n";
import { fmtYmd } from "@/lib/format";
import { Banner, Button, EmptyState, Field, RadioCards, Sheet, Skeleton, TextField, useToast } from "../ui";
import { addYmd, todayYmd } from "./dates";

export type PlanRow = {
  id: string;
  name: string;
  type: "period" | "punch" | "punch_period" | "trial";
  sessions_granted: number | null;
  validity_days: number | null;
  price: string | null;
  active: number;
};

export function planSummary(p: Pick<PlanRow, "type" | "sessions_granted" | "validity_days">): string {
  const parts: string[] = [PLAN_TYPE_LABEL[p.type]];
  if (p.type !== "period" && p.sessions_granted) parts.push(p.sessions_granted === 1 ? "שיעור אחד" : `${p.sessions_granted} שיעורים`);
  if (p.validity_days) parts.push(`תקף ${p.validity_days} ימים`);
  else if (p.type === "punch") parts.push("ללא תאריך תפוגה");
  return parts.join(" · ");
}

type Prev = { membership: { id: string; plan_id: string; status: string }; dates: { start: string; end: string | null } };

/** Create or renew a local membership (spec MEM-01). */
export function MembershipSheet({
  open,
  onClose,
  contactId,
  contactName,
  renewFrom,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  contactId: string;
  contactName: string;
  renewFrom?: string | null;
  onDone: () => void;
}) {
  const toast = useToast();
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [start, setStart] = useState(todayYmd());
  const [end, setEnd] = useState<string>("");
  const [endTouched, setEndTouched] = useState(false);
  const [sessions, setSessions] = useState<string>("");
  const [reference, setReference] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const key = useRef(newKey());

  useEffect(() => {
    if (!open) return;
    key.current = newKey();
    setErrors({});
    setMessage(null);
    setReference("");
    setEndTouched(false);
    setSessions("");
    setStart(todayYmd());
    Promise.all([api<PlanRow[]>("/api/plans"), renewFrom ? api<Prev>(`/api/memberships/${renewFrom}`) : Promise.resolve(null)])
      .then(([p, prev]) => {
        setPlans(p);
        const prevPlan = prev ? p.find((x) => x.id === prev.membership.plan_id) : null;
        setPlanId(prevPlan?.id ?? (p.length === 1 ? p[0].id : null));
        if (prev?.dates.end) {
          const next = addYmd(prev.dates.end, 1);
          setStart(next > todayYmd() ? next : todayYmd());
        }
      })
      .catch((e) => setMessage((e as Error).message));
  }, [open, renewFrom]);

  const plan = plans?.find((p) => p.id === planId) ?? null;
  const usesSessions = !!plan && plan.type !== "period";

  // End date follows the plan validity until the user edits it.
  useEffect(() => {
    if (endTouched) return;
    if (plan?.validity_days && start) setEnd(addYmd(start, plan.validity_days - 1));
    else setEnd("");
  }, [plan, start, endTouched]);

  const summary = useMemo(() => {
    if (!plan) return null;
    const n = usesSessions ? Number(sessions || plan.sessions_granted || 1) : null;
    return `ייווצר ${renewFrom ? "חידוש" : "מנוי"} "${plan.name}" מ-${fmtYmd(start)}${end ? ` עד ${fmtYmd(end)} (כולל)` : " ללא תאריך סיום"}${n ? ` · ${n === 1 ? "שיעור אחד" : `${n} שיעורים`}` : ""}.`;
  }, [plan, start, end, sessions, usesSessions, renewFrom]);

  const save = async () => {
    if (!planId) return setErrors({ plan_id: "בחרו מסלול." });
    setSaving(true);
    setMessage(null);
    setErrors({});
    try {
      await api("/api/memberships", {
        body: {
          contact_id: contactId,
          plan_id: planId,
          start_date: start,
          end_date: end || null,
          sessions: usesSessions && sessions ? Number(sessions) : null,
          reference: reference.trim() || null,
          renewed_from: renewFrom ?? null,
        },
        idempotencyKey: key.current,
      });
      toast(renewFrom ? "המנוי חודש" : "המנוי נוצר", "success");
      onDone();
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
      title={renewFrom ? "חידוש מנוי" : "מנוי חדש"}
      subtitle={contactName}
      footer={
        plans && plans.length > 0 ? (
          <>
            <Button onClick={onClose}>ביטול</Button>
            <Button variant="primary" loading={saving} disabled={!planId} onClick={save}>
              {renewFrom ? "חידוש" : "יצירת מנוי"}
            </Button>
          </>
        ) : undefined
      }
    >
      {message && (
        <div style={{ marginBottom: 12 }}>
          <Banner tone="danger">{message}</Banner>
        </div>
      )}
      {plans === null ? (
        <div className="stack-2">
          <Skeleton height={56} />
          <Skeleton height={56} />
          <Skeleton height={56} />
        </div>
      ) : plans.length === 0 ? (
        <EmptyState
          icon="card"
          title="עדיין אין מסלולים"
          text="כדי ליצור מנוי צריך קודם להגדיר מסלול (למשל מנוי חודשי או כרטיסייה)."
          action={
            <Link href="/memberships?tab=plans" className="btn primary">
              הגדרת מסלול
            </Link>
          }
        />
      ) : (
        <div className="stack-4">
          <Field label="מסלול" error={errors.plan_id}>
            <RadioCards
              value={planId}
              onChange={(v) => {
                setPlanId(v);
                setEndTouched(false);
                setSessions("");
              }}
              options={plans.map((p) => ({ value: p.id, label: p.name, hint: planSummary(p) }))}
            />
          </Field>
          {plan && (
            <div className="stack-4 fade-in">
              <div className="grid-2">
                <TextField label="תאריך התחלה" type="date" value={start} onChange={(e) => setStart(e.target.value)} error={errors.start_date} />
                <TextField
                  label="תאריך סיום"
                  type="date"
                  value={end}
                  min={start}
                  optional={!plan.validity_days}
                  onChange={(e) => {
                    setEnd(e.target.value);
                    setEndTouched(true);
                  }}
                  error={errors.end_date}
                  hint="היום שנבחר כלול במנוי"
                />
              </div>
              {usesSessions && (
                <TextField
                  label="מספר שיעורים"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={sessions}
                  placeholder={String(plan.sessions_granted ?? 1)}
                  onChange={(e) => setSessions(e.target.value)}
                  error={errors.sessions}
                  hint={`ברירת המחדל של המסלול: ${plan.sessions_granted ?? 1}`}
                />
              )}
              <TextField label="אסמכתה" optional value={reference} onChange={(e) => setReference(e.target.value)} placeholder="מספר קבלה / אישור תשלום" hint="StudioMate לא גובה תשלום — זה רק לתיעוד." />
              {summary && <Banner tone="ok">{summary}</Banner>}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
