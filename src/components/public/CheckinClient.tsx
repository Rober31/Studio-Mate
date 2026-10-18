"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, newKey } from "@/lib/api";
import { Icon } from "../Icon";
import { Button, SuccessCheck } from "../ui";
import "@/app/sessions.css";

type Result = {
  status: "checked_in" | "already_recorded";
  already_recorded: boolean;
  session_title: string;
  checked_in_at: string;
  plan_name: string | null;
  balance: number | null;
  balance_authority: "local" | "external" | "none";
  attendance_status: string;
};

type Failure = { kind: "expired" | "not_eligible" | "window_closed" | "invalid_code" | "no_member" | "network" | "other"; message: string };

/** S09 — auto-submits once; repeats reuse the same idempotency key so no double deduction. */
export function CheckinClient({ slug, token, studioName, firstName }: { slug: string; token: string; studioName: string; firstName: string }) {
  const key = useRef(newKey());
  const started = useRef(false);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [result, setResult] = useState<Result | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const submit = useCallback(async () => {
    setState("loading");
    try {
      const r = await api<Result>("/api/member/check-ins", { body: { challenge_token: token, slug }, idempotencyKey: key.current });
      setResult(r);
      setState("ok");
      if ("vibrate" in navigator) navigator.vibrate?.(30);
    } catch (e) {
      const err = e as ApiError;
      const reason = (err.details?.reason as string | undefined) ?? "";
      const kind: Failure["kind"] =
        err.status === 0
          ? "network"
          : reason === "expired"
            ? "expired"
            : reason === "not_eligible"
              ? "not_eligible"
              : reason === "window_closed"
                ? "window_closed"
                : reason === "invalid_code"
                  ? "invalid_code"
                  : reason === "no_member_session"
                    ? "no_member"
                    : "other";
      setFailure({ kind, message: err.message });
      setState("error");
    }
  }, [slug, token]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    submit();
  }, [submit]);

  const time = result ? new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(result.checked_in_at)) : "";

  return (
    <div className="center-screen">
      <div className="auth-card public-card" style={{ textAlign: "center" }} aria-live="polite">
        <div className="col" style={{ alignItems: "center", gap: 14 }}>
          <div className="public-studio">{studioName}</div>
          {state === "loading" && (
            <>
              <div className="empty-icon" style={{ margin: 0 }}>
                <span className="spinner" />
              </div>
              <h1 style={{ fontSize: 22 }}>רושמים נוכחות…</h1>
            </>
          )}
          {state === "ok" && result && (
            <>
              <SuccessCheck />
              <h1 style={{ fontSize: 24 }}>{result.already_recorded ? "כבר נרשמה נוכחות" : `נרשמת, ${firstName}!`}</h1>
              <div className="card" style={{ width: "100%", padding: "12px 16px", background: "var(--surface-2)" }}>
                <div className="bold">{result.session_title}</div>
                <div className="small muted num">נרשם ב-{time}</div>
                {result.attendance_status === "pending_reconciliation" && <div className="xsmall subtle" style={{ marginTop: 6 }}>הנוכחות תאושר מול מערכת ההזמנות של הסטודיו.</div>}
                {result.balance_authority === "local" && result.balance !== null && (
                  <div className="small" style={{ marginTop: 6 }}>
                    {result.plan_name} · נשארו <span className="bold num">{result.balance}</span> שיעורים
                  </div>
                )}
              </div>
              <p className="muted">שיעור נעים!</p>
            </>
          )}
          {state === "error" && failure && (
            <>
              <div className="empty-icon" style={{ margin: 0, background: failure.kind === "network" ? "var(--orange-soft)" : "var(--red-soft)", color: failure.kind === "network" ? "var(--orange)" : "var(--red)" }}>
                <Icon name={failure.kind === "network" ? "alert" : failure.kind === "expired" ? "refresh" : "xCircle"} size={28} />
              </div>
              <h1 style={{ fontSize: 22 }}>
                {failure.kind === "network"
                  ? "הנוכחות עוד לא נרשמה"
                  : failure.kind === "expired"
                    ? "הקוד התחלף"
                    : failure.kind === "not_eligible"
                      ? "לא הצלחנו לרשום"
                      : failure.kind === "window_closed"
                        ? "הרישום סגור כרגע"
                        : "לא הצלחנו לרשום"}
              </h1>
              <p className="muted">
                {failure.kind === "network"
                  ? "אין חיבור לאינטרנט. התחברו ונסו שוב — לא יירד שיעור פעמיים."
                  : failure.kind === "expired"
                    ? "סרקו שוב את הקוד שמוצג עכשיו על המסך."
                    : failure.kind === "not_eligible"
                      ? "לא נמצא מנוי בתוקף. גשו לקבלה ונסדר את זה."
                      : failure.message}
              </p>
              {failure.kind === "network" && (
                <Button variant="primary" block onClick={submit}>
                  ניסיון נוסף
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
