"use client";

import { useMemo, useState } from "react";
import { api, ApiError, newKey } from "@/lib/api";
import { Banner, Button, Checkbox, SelectField, SuccessCheck, TextArea, TextField } from "../ui";
import "@/app/sessions.css";

const COUNTRIES = [
  { value: "IL", label: "🇮🇱 ‎+972" },
  { value: "PS", label: "🇵🇸 ‎+970" },
  { value: "JO", label: "🇯🇴 ‎+962" },
  { value: "US", label: "🇺🇸 ‎+1" },
  { value: "GB", label: "🇬🇧 ‎+44" },
  { value: "FR", label: "🇫🇷 ‎+33" },
  { value: "RU", label: "🇷🇺 ‎+7" },
  { value: "UA", label: "🇺🇦 ‎+380" },
];

const INTERESTS = ["פילאטיס מכשירים", "פילאטיס מזרן", "הריון ואחרי לידה", "שיקום גב", "עוד לא יודע/ת"];

/** S08 — public registration request. Never reveals whether the number is known. */
export function RegistrationForm({ slug, studioName, defaultCountry, noticeText }: { slug: string; studioName: string; defaultCountry: string; noticeText: string }) {
  const requestId = useMemo(() => newKey().replace(/[^A-Za-z0-9_-]/g, ""), []);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState(COUNTRIES.some((c) => c.value === defaultCountry) ? defaultCountry : "IL");
  const [language, setLanguage] = useState("");
  const [interest, setInterest] = useState("");
  const [note, setNote] = useState("");
  const [allowed, setAllowed] = useState(false);
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!name.trim()) local.name = "איך קוראים לך?";
    if (phone.replace(/\D/g, "").length < 7) local.phone = "מה מספר הטלפון?";
    setErrors(local);
    if (Object.keys(local).length) return;
    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/public/${slug}/registrations`, {
        body: { request_id: requestId, name, phone, country, language: language || undefined, interest: interest || undefined, note: note || undefined, contact_allowed: allowed, website },
      });
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.fields && Object.keys(err.fields).length) setErrors(err.fields);
        else setMessage(err.message);
      } else setMessage("משהו השתבש. נסו שוב.");
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <div className="auth-card public-card" style={{ textAlign: "center" }}>
        <div className="col" style={{ alignItems: "center", gap: 14 }}>
          <div className="public-studio">{studioName}</div>
          <SuccessCheck />
          <h1 style={{ fontSize: 24 }}>תודה, קיבלנו!</h1>
          <p className="muted">הבקשה הגיעה לצוות הסטודיו. נחזור אליך בהקדם כדי לתאם את הצעד הבא.</p>
          <p className="xsmall subtle">אין צורך לשלוח שוב. אם יש שאלה דחופה — אפשר לפנות ישירות לסטודיו.</p>
        </div>
      </div>
    );
  }

  return (
    <form className="auth-card public-card" onSubmit={submit} noValidate>
      <div className="public-head">
        <div className="public-studio">{studioName}</div>
        <h1 style={{ fontSize: 26, marginTop: 6 }}>נעים להכיר!</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          השאירו פרטים ונחזור אליך לתיאום.
        </p>
      </div>
      <div className="stack-4">
        {message && <Banner tone="danger">{message}</Banner>}
        <TextField label="שם מלא" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={80} />
        <div className="field">
          <label className="field-label" htmlFor="reg-phone">
            טלפון
          </label>
          <div className="phone-row">
            <select className="select" aria-label="קידומת מדינה" value={country} onChange={(e) => setCountry(e.target.value)} dir="ltr">
              {COUNTRIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              id="reg-phone"
              className="input"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              dir="ltr"
              placeholder="050-0000000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-invalid={errors.phone ? true : undefined}
              maxLength={30}
            />
          </div>
          {errors.phone && (
            <span className="field-error" role="alert">
              {errors.phone}
            </span>
          )}
        </div>
        <div className="field">
          <span className="field-label">
            מה מעניין אותך? <span className="opt">(לא חובה)</span>
          </span>
          <div className="row wrap" style={{ gap: 6 }}>
            {INTERESTS.map((i) => (
              <button key={i} type="button" className="chip" aria-pressed={interest === i} onClick={() => setInterest(interest === i ? "" : i)}>
                {i}
              </button>
            ))}
          </div>
        </div>
        <SelectField
          label="שפה מועדפת לשיחה"
          optional
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          placeholder="לא משנה"
          options={[
            { value: "he", label: "עברית" },
            { value: "ar", label: "العربية" },
            { value: "en", label: "English" },
          ]}
        />
        <TextArea label="משהו שחשוב שנדע?" optional rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="למשל: שעות שנוחות לך" hint="אין צורך במידע רפואי." />
        <div className="hp-field" aria-hidden>
          <label>
            אתר
            <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
        </div>
        <div className="notice">{noticeText}</div>
        <Checkbox checked={allowed} onChange={setAllowed}>
          מאשר/ת לקבל מהסטודיו הודעות בוואטסאפ
          <span className="xsmall muted" style={{ display: "block" }}>
            לא חובה. בלי אישור ניצור קשר רק בשיחת טלפון.
          </span>
        </Checkbox>
        <Button type="submit" variant="primary" size="lg" block loading={saving}>
          שליחה
        </Button>
      </div>
    </form>
  );
}
