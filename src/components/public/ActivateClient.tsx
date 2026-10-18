"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Icon } from "../Icon";
import { Banner, Button, SuccessCheck } from "../ui";
import "@/app/sessions.css";

export function ActivateClient({ token, studioName, firstName }: { token: string; studioName: string; firstName: string }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activate = async () => {
    setLoading(true);
    setError(null);
    try {
      await api("/api/member/activation/redeem", { body: { token } });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="center-screen">
      <div className="auth-card public-card" style={{ textAlign: "center" }}>
        <div className="col" style={{ alignItems: "center", gap: 14 }}>
          <div className="public-studio">{studioName}</div>
          {done ? (
            <>
              <SuccessCheck />
              <h1 style={{ fontSize: 24 }}>הטלפון מחובר</h1>
              <p className="muted">מעכשיו סורקים את הקוד שמוצג בשיעור — והנוכחות נרשמת.</p>
              <p className="xsmall subtle">החיבור שמור בדפדפן הזה. אם מחליפים טלפון או מנקים נתוני גלישה — מבקשים קישור חדש בקבלה.</p>
            </>
          ) : (
            <>
              <div className="empty-icon" style={{ margin: 0 }}>
                <Icon name="smartphone" size={28} />
              </div>
              <h1 style={{ fontSize: 24 }}>היי {firstName}!</h1>
              <p className="muted">חיבור חד-פעמי של הטלפון הזה כדי לרשום נוכחות בשיעורים בסריקת QR.</p>
              {error && <Banner tone="danger">{error}</Banner>}
              <Button variant="primary" size="lg" block loading={loading} onClick={activate}>
                חיבור הטלפון
              </Button>
              <p className="xsmall subtle">החיבור מאפשר רק רישום נוכחות. הוא לא נותן גישה לפרטים אחרים.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
