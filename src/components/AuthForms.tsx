"use client";

import { useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Button, Checkbox, TextField, Banner, SuccessCheck } from "./ui";
import { BrandMark } from "./BrandMark";

function useForm<T extends Record<string, string>>(initial: T) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const bind = (k: keyof T) => ({
    value: values[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setValues((v) => ({ ...v, [k]: e.target.value }));
      if (errors[k as string]) setErrors((er) => ({ ...er, [k]: "" }));
    },
    error: errors[k as string] || undefined,
  });
  const submit = async (fn: () => Promise<void>) => {
    setLoading(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.fields) setErrors(e.fields);
        setMessage(e.fields && Object.keys(e.fields).length ? null : e.message);
      } else setMessage("משהו השתבש. נסו שוב.");
    } finally {
      setLoading(false);
    }
  };
  return { values, bind, submit, loading, message, setMessage };
}

export function AuthHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="col" style={{ alignItems: "center", textAlign: "center", gap: 10, marginBottom: 28 }}>
      <BrandMark size={52} />
      <h1 style={{ fontSize: 26, marginTop: 6 }}>{title}</h1>
      {subtitle && <p className="muted">{subtitle}</p>}
    </div>
  );
}

export function LoginForm() {
  const f = useForm({ email: "", password: "" });
  return (
    <form
      className="stack-4"
      onSubmit={(e) => {
        e.preventDefault();
        f.submit(async () => {
          await api("/api/auth/login", { body: f.values });
          window.location.href = "/";
        });
      }}
      noValidate
    >
      {f.message && <Banner tone="danger">{f.message}</Banner>}
      <TextField label="אימייל" type="email" autoComplete="email" inputMode="email" dir="ltr" required autoFocus {...f.bind("email")} />
      <TextField label="סיסמה" type="password" autoComplete="current-password" dir="ltr" required {...f.bind("password")} />
      <Button type="submit" variant="primary" size="lg" block loading={f.loading}>
        כניסה
      </Button>
      <div className="small muted" style={{ textAlign: "center" }}>
        <Link href="/forgot" style={{ color: "var(--accent)" }}>
          שכחתי סיסמה
        </Link>
      </div>
    </form>
  );
}

export function SetupForm() {
  const f = useForm({ studio_name: "", owner_name: "", email: "", password: "" });
  const [qr, setQr] = useState(true);
  return (
    <form
      className="stack-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        f.submit(async () => {
          await api("/api/auth/setup", {
            body: { ...f.values, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Jerusalem", modules: qr ? ["crm", "ai", "qr"] : ["crm", "ai"] },
          });
          window.location.href = "/today";
        });
      }}
    >
      {f.message && <Banner tone="danger">{f.message}</Banner>}
      <TextField label="שם הסטודיו" autoFocus {...f.bind("studio_name")} placeholder="למשל: סטודיו נשימה" />
      <TextField label="השם שלך" autoComplete="name" {...f.bind("owner_name")} />
      <TextField label="אימייל" type="email" autoComplete="email" dir="ltr" {...f.bind("email")} />
      <TextField label="סיסמה" type="password" autoComplete="new-password" dir="ltr" hint="10 תווים לפחות" {...f.bind("password")} />
      <Checkbox checked={qr} onChange={setQr}>
        להפעיל הרשמה ונוכחות ב-QR
        <span className="xsmall muted" style={{ display: "block" }}>
          מתאים לסטודיו שאין לו אפליקציית הזמנות. אפשר לשנות אחר כך בהגדרות.
        </span>
      </Checkbox>
      <Button type="submit" variant="primary" size="lg" block loading={f.loading}>
        יצירת הסטודיו
      </Button>
    </form>
  );
}

export function InviteForm({ token, email, hasUser }: { token: string; email: string; hasUser: boolean }) {
  const f = useForm({ name: "", password: "" });
  return (
    <form
      className="stack-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        f.submit(async () => {
          await api("/api/auth/invite", { body: { token, ...f.values } });
          window.location.href = "/";
        });
      }}
    >
      {f.message && <Banner tone="danger">{f.message}</Banner>}
      <TextField label="אימייל" value={email} disabled dir="ltr" readOnly />
      {!hasUser && <TextField label="השם שלך" autoComplete="name" autoFocus {...f.bind("name")} />}
      <TextField
        label={hasUser ? "הסיסמה של החשבון הקיים" : "בחירת סיסמה"}
        type="password"
        autoComplete={hasUser ? "current-password" : "new-password"}
        dir="ltr"
        hint={hasUser ? undefined : "10 תווים לפחות"}
        {...f.bind("password")}
      />
      <Button type="submit" variant="primary" size="lg" block loading={f.loading}>
        הצטרפות לצוות
      </Button>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const f = useForm({ password: "" });
  const [done, setDone] = useState(false);
  if (done)
    return (
      <div className="col" style={{ alignItems: "center", gap: 16, textAlign: "center" }}>
        <SuccessCheck />
        <p>הסיסמה עודכנה. אפשר להיכנס עם הסיסמה החדשה.</p>
        <Link href="/login" className="btn primary block">
          לכניסה
        </Link>
      </div>
    );
  return (
    <form
      className="stack-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        f.submit(async () => {
          await api("/api/auth/reset", { body: { token, ...f.values } });
          setDone(true);
        });
      }}
    >
      {f.message && <Banner tone="danger">{f.message}</Banner>}
      <TextField label="סיסמה חדשה" type="password" autoComplete="new-password" dir="ltr" hint="10 תווים לפחות" autoFocus {...f.bind("password")} />
      <Button type="submit" variant="primary" size="lg" block loading={f.loading}>
        שמירת הסיסמה
      </Button>
    </form>
  );
}
