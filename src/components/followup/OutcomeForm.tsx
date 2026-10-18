"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { OUTCOME_ICON, OUTCOME_LABEL, CHANNEL_LABEL } from "@/lib/i18n";
import { localInputValue, tomorrowAt } from "@/lib/format";
import { Banner, Button, Field, RadioCards, Segmented, TextArea, TextField, SelectField, Checkbox } from "../ui";

export type OutcomeTarget = {
  contactId: string;
  suggestionId?: string | null;
  draftId?: string | null;
  taskId?: string | null;
  taskVersion?: number;
  defaultChannel?: "whatsapp" | "call" | "in_person" | "none";
  memberships?: { id: string; plan_name: string; status: string }[];
};

const OUTCOMES = ["no_answer", "interested", "needs_time", "asked_details", "wants_trial", "renewed", "not_interested", "stop_contact"] as const;

const FOLLOW_PRESETS = [
  { key: "none", label: "בלי" },
  { key: "tomorrow", label: "מחר" },
  { key: "3d", label: "בעוד 3 ימים" },
  { key: "week", label: "בעוד שבוע" },
  { key: "custom", label: "תאריך…" },
] as const;

function presetDate(key: string): Date | null {
  if (key === "tomorrow") return tomorrowAt(10);
  if (key === "3d") {
    const d = tomorrowAt(10);
    d.setDate(d.getDate() + 2);
    return d;
  }
  if (key === "week") {
    const d = tomorrowAt(10);
    d.setDate(d.getDate() + 6);
    return d;
  }
  return null;
}

/** Records what happened and the next step (FUP-03). */
export function OutcomeForm({ target, onSaved, submitLabel = "שמירת התוצאה" }: { target: OutcomeTarget; onSaved: () => void; submitLabel?: string }) {
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number] | null>(null);
  const [channel, setChannel] = useState<string>(target.defaultChannel ?? "whatsapp");
  const [note, setNote] = useState("");
  const [follow, setFollow] = useState<string>("none");
  const [customDate, setCustomDate] = useState(localInputValue(tomorrowAt(10)));
  const [followTitle, setFollowTitle] = useState("");
  const [membershipId, setMembershipId] = useState("");
  const [reference, setReference] = useState("");
  const [closeLead, setCloseLead] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Sensible default next step per outcome.
  const pick = (o: (typeof OUTCOMES)[number]) => {
    setOutcome(o);
    setErrors({});
    if (o === "no_answer" || o === "needs_time") setFollow(o === "no_answer" ? "tomorrow" : "week");
    else if (o === "asked_details" || o === "interested" || o === "wants_trial") setFollow("3d");
    else setFollow("none");
  };

  const save = async () => {
    if (!outcome) return setErrors({ outcome: "בחרו מה קרה." });
    const dueDate = follow === "custom" ? new Date(customDate) : presetDate(follow);
    setSaving(true);
    setMessage(null);
    try {
      await api("/api/interactions", {
        body: {
          contact_id: target.contactId,
          suggestion_id: target.suggestionId ?? undefined,
          draft_id: target.draftId ?? undefined,
          task_id: target.taskId ?? undefined,
          task_version: target.taskVersion,
          outcome,
          channel,
          note: note.trim() || undefined,
          follow_up: dueDate && outcome !== "stop_contact" ? { due_at: dueDate.toISOString(), title: followTitle.trim() || undefined } : null,
          membership_id: outcome === "renewed" && membershipId ? membershipId : undefined,
          renewal_reference: outcome === "renewed" ? reference.trim() || undefined : undefined,
          lost_reason: outcome === "not_interested" && closeLead ? lostReason.trim() || "לא מעוניין/ת" : undefined,
        },
      });
      onSaved();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.fields) setErrors(e.fields);
        setMessage(e.fields ? null : e.message);
      } else setMessage("משהו השתבש. נסו שוב.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack-4">
      {message && <Banner tone="danger">{message}</Banner>}
      <Field label="מה קרה?" error={errors.outcome}>
        <RadioCards
          columns={2}
          value={outcome}
          onChange={pick}
          options={OUTCOMES.map((o) => ({ value: o, label: OUTCOME_LABEL[o], icon: OUTCOME_ICON[o] }))}
        />
      </Field>

      {outcome === "renewed" && (
        <div className="stack-3 fade-in">
          {target.memberships && target.memberships.length > 0 && (
            <SelectField
              label="המנוי המתועד"
              value={membershipId}
              onChange={(e) => setMembershipId(e.target.value)}
              placeholder="בחירת מנוי…"
              options={target.memberships.map((m) => ({ value: m.id, label: m.plan_name }))}
            />
          )}
          <TextField
            label="או אסמכתה"
            optional
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="מספר קבלה / אישור מהאפליקציה"
            error={errors.renewal_reference}
            hint="חידוש נספר רק עם מנוי מתועד או אסמכתה."
          />
        </div>
      )}
      {outcome === "stop_contact" && (
        <Banner tone="warn">אחרי השמירה לא יוצגו יותר הודעות או מעקבים שיווקיים ללקוח הזה.</Banner>
      )}
      {outcome === "not_interested" && (
        <div className="stack-3 fade-in">
          <Checkbox checked={closeLead} onChange={setCloseLead}>
            לסגור את התיק כ&quot;לא רלוונטי&quot;
          </Checkbox>
          {closeLead && <TextField label="סיבה קצרה" value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="למשל: המחיר, מרחק, מצא/ה מקום אחר" />}
        </div>
      )}

      <Field label="איך?">
        <Segmented
          block
          value={channel}
          onChange={setChannel}
          options={(["whatsapp", "call", "in_person", "none"] as const).map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))}
        />
      </Field>

      <TextArea label="סיכום קצר" optional rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="מה נאמר, מה חשוב לזכור" />

      {outcome !== "stop_contact" && (
        <Field label="מעקב הבא" error={errors.follow_up}>
          <div className="chips" style={{ marginInline: 0, paddingInline: 0, flexWrap: "wrap" }}>
            {FOLLOW_PRESETS.map((p) => (
              <button key={p.key} type="button" className="chip" aria-pressed={follow === p.key} onClick={() => setFollow(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
          {follow === "custom" && (
            <input className="input fade-in" type="datetime-local" value={customDate} onChange={(e) => setCustomDate(e.target.value)} aria-label="מועד המעקב הבא" />
          )}
          {follow !== "none" && (
            <input className="input fade-in" value={followTitle} onChange={(e) => setFollowTitle(e.target.value)} placeholder="על מה המעקב? (לא חובה)" aria-label="נושא המעקב" />
          )}
        </Field>
      )}

      <Button variant="primary" size="lg" block loading={saving} onClick={save} disabled={!outcome}>
        {submitLabel}
      </Button>
    </div>
  );
}
