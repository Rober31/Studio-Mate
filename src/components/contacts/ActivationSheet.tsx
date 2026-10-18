"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { Icon } from "../Icon";
import { Banner, Button, Sheet, Skeleton, useToast } from "../ui";

/** One-time link that connects the member's own phone for QR attendance (QR-02 step 1). */
export function ActivationSheet({
  open,
  onClose,
  contactId,
  firstName,
  phone,
  tz,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  contactId: string;
  firstName: string;
  phone: string | null;
  tz: string;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [link, setLink] = useState<{ url: string; expires: string } | null>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setLink(null);
      setSvg("");
      setError(null);
      return;
    }
    api<{ token: string; expires_at: string }>(`/api/contacts/${contactId}/activation`, { method: "POST" })
      .then(async (r) => {
        const url = `${window.location.origin}/m/activate/${r.token}`;
        setLink({ url, expires: r.expires_at });
        setSvg(await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#16191d", light: "#ffffff" } }));
        onCreated();
      })
      .catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contactId]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast("הקישור הועתק", "success");
    } catch {
      toast("לא הצלחנו להעתיק", "error");
    }
  };

  const waText = link ? `היי ${firstName}, זה הקישור להפעלת רישום הנוכחות בטלפון שלך. פתחו אותו פעם אחת מהטלפון: ${link.url}` : "";
  const waUrl = phone && link ? `https://wa.me/${phone.replace(/^\+/, "")}?text=${encodeURIComponent(waText)}` : null;

  return (
    <Sheet open={open} onClose={onClose} title="הפעלת נוכחות בטלפון" subtitle={`חיבור הטלפון של ${firstName} לרישום נוכחות ב-QR`}>
      <div className="stack-4">
        {error && <Banner tone="danger">{error}</Banner>}
        {!link && !error && (
          <div className="stack-2">
            <Skeleton height={220} radius={20} />
            <Skeleton height={16} width="70%" />
          </div>
        )}
        {link && (
          <>
            <p className="small muted">
              אפשרות 1 — כאן בסטודיו: הלקוח סורק את הקוד עם המצלמה של הטלפון שלו. אפשרות 2 — שליחת הקישור למספר שלו בוואטסאפ.
            </p>
            <div className="row" style={{ justifyContent: "center" }}>
              <div className="qr-box" style={{ padding: 14 }} aria-label="קוד QR להפעלה" role="img" dangerouslySetInnerHTML={{ __html: svg.replace("<svg", '<svg width="220" height="220"') }} />
            </div>
            <div className="row wrap" style={{ justifyContent: "center" }}>
              {waUrl ? (
                <a className="btn whatsapp" href={waUrl} target="_blank" rel="noopener noreferrer">
                  <Icon name="whatsapp" size={18} /> שליחה בוואטסאפ
                </a>
              ) : (
                <span className="small muted">אין מספר טלפון תקין לשליחה.</span>
              )}
              <Button icon="copy" onClick={copy}>
                העתקת הקישור
              </Button>
            </div>
            <Banner tone="info">
              הקישור חד-פעמי ותקף עד {fmtDateTime(link.expires, tz)}. שלחו אותו רק למספר המאומת של הלקוח. יצירת קישור חדש מבטלת קישורים קודמים שלא שומשו.
            </Banner>
          </>
        )}
      </div>
    </Sheet>
  );
}
