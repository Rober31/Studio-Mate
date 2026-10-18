"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { ymd } from "@/lib/format";
import { Banner, Button, SelectField, Sheet, TextArea, TextField, useToast } from "../ui";

export type SessionItem = {
  id: string;
  title: string;
  trainer_id: string | null;
  trainer_name: string | null;
  start_at: string;
  end_at: string;
  status: "scheduled" | "open" | "completed" | "cancelled";
  cancel_reason: string | null;
  version: number;
  attendance_count: number;
};

function hhmm(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

const TITLE_SUGGESTIONS = ["פילאטיס מכשירים", "פילאטיס מזרן", "פילאטיס הריון", "שיקום גב", "פילאטיס מתחילים"];

/** Create or edit a class session (QR-04). Editing a past session requires a reason. */
export function SessionFormSheet({
  open,
  onClose,
  session,
  defaultDate,
  tz,
  staff,
}: {
  open: boolean;
  onClose: () => void;
  session?: SessionItem | null;
  defaultDate: string;
  tz: string;
  staff: { id: string; name: string; role?: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("08:55");
  const [trainer, setTrainer] = useState("");
  const [repeat, setRepeat] = useState("1");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isPast = !!session && session.start_at < new Date().toISOString();

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setMessage(null);
    setReason("");
    if (session) {
      setTitle(session.title);
      setDate(ymd(session.start_at, tz));
      setStart(hhmm(session.start_at, tz));
      setEnd(hhmm(session.end_at, tz));
      setTrainer(session.trainer_id ?? "");
    } else {
      setTitle("");
      setDate(defaultDate);
      setStart("08:00");
      setEnd("08:55");
      setTrainer("");
      setRepeat("1");
    }
  }, [open, session, defaultDate, tz]);

  // Keep a 55-minute default length when the start time changes on a new session.
  const changeStart = (v: string) => {
    setStart(v);
    if (!session && /^\d{2}:\d{2}$/.test(v)) {
      const [h, m] = v.split(":").map(Number);
      const total = h * 60 + m + 55;
      if (total < 24 * 60) setEnd(`${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`);
    }
  };

  const save = async () => {
    setSaving(true);
    setErrors({});
    setMessage(null);
    try {
      if (session) {
        await api(`/api/sessions/${session.id}`, {
          method: "PATCH",
          body: { title, date, start, end, trainer_id: trainer || null, version: session.version, change_reason: reason || undefined },
        });
        toast("השיעור עודכן", "success");
      } else {
        await api("/api/sessions", { body: { title, date, start, end, trainer_id: trainer || null, repeat_weeks: Number(repeat) } });
        toast(Number(repeat) > 1 ? `נוספו ${repeat} שיעורים` : "השיעור נוסף", "success");
      }
      onClose();
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.fields) setErrors(e.fields);
        setMessage(e.fields && Object.keys(e.fields).length ? null : e.message);
      } else setMessage("משהו השתבש. נסו שוב.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={session ? "עריכת שיעור" : "שיעור חדש"}
      footer={
        <>
          <Button onClick={onClose}>ביטול</Button>
          <Button variant="primary" loading={saving} onClick={save} disabled={!title.trim()}>
            {session ? "שמירה" : "הוספה"}
          </Button>
        </>
      }
    >
      <div className="stack-4">
        {message && <Banner tone="danger">{message}</Banner>}
        <div className="stack-2">
          <TextField label="שם השיעור" value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} autoFocus={!session} placeholder="למשל: פילאטיס מכשירים" />
          {!session && !title && (
            <div className="row wrap" style={{ gap: 6 }}>
              {TITLE_SUGGESTIONS.map((t) => (
                <button key={t} type="button" className="chip" style={{ height: 30 }} onClick={() => setTitle(t)}>
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
        <TextField label="תאריך" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
        <div className="grid-2">
          <TextField label="התחלה" type="time" value={start} onChange={(e) => changeStart(e.target.value)} error={errors.start} />
          <TextField label="סיום" type="time" value={end} onChange={(e) => setEnd(e.target.value)} error={errors.end} />
        </div>
        <SelectField
          label="מדריך/ה"
          optional
          value={trainer}
          onChange={(e) => setTrainer(e.target.value)}
          placeholder="ללא שיוך"
          options={staff.map((s) => ({ value: s.id, label: s.name }))}
          error={errors.trainer_id}
          hint="מדריך/ה משויך/ת רואה את השיעור ויכול/ה לרשום בו נוכחות."
        />
        {!session && (
          <SelectField
            label="חזרה שבועית"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            options={[
              { value: "1", label: "פעם אחת" },
              { value: "4", label: "כל שבוע · 4 שבועות" },
              { value: "8", label: "כל שבוע · 8 שבועות" },
              { value: "12", label: "כל שבוע · 12 שבועות" },
            ]}
          />
        )}
        {session && isPast && (
          <TextArea
            label="סיבת השינוי"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={errors.change_reason}
            hint="השיעור כבר התקיים. שינוי בשעות נשמר ביומן עם הסיבה."
          />
        )}
      </div>
    </Sheet>
  );
}
