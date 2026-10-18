"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { api } from "@/lib/api";
import { fmtDateTime, fmtPhone, relTime } from "@/lib/format";
import { Icon } from "../Icon";
import { Avatar, Badge, Button, EmptyState, Menu, Segmented, Sheet, useToast } from "../ui";
import "@/app/sessions.css";

type Registration = {
  id: string;
  name: string;
  phone_e164: string | null;
  interest: string | null;
  note: string | null;
  contact_allowed: number;
  matched_existing: number;
  contact_id: string | null;
  contact_name: string | null;
  status: "new" | "reviewed" | "rejected";
  created_at: string;
};

const STATUS_LABEL = { new: "חדשה", reviewed: "טופלה", rejected: "נדחתה" };

export function RegistrationsView({
  items,
  staff,
  slug,
  studioName,
  tz,
  canOpenContact,
}: {
  items: Registration[];
  staff: { id: string; name: string }[];
  slug: string;
  studioName: string;
  tz: string;
  canOpenContact: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState<"new" | "all">("new");
  const [poster, setPoster] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const newCount = items.filter((i) => i.status === "new").length;
  const list = useMemo(() => (filter === "new" ? items.filter((i) => i.status === "new") : items), [items, filter]);

  const update = async (r: Registration, body: { status?: "reviewed" | "rejected"; owner_id?: string | null }, msg: string) => {
    setBusy(r.id);
    try {
      await api(`/api/registrations/${r.id}`, { method: "PATCH", body });
      toast(msg, "success");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">בקשות הרשמה</h1>
          <p className="page-sub">{newCount ? `${newCount} בקשות חדשות מחכות לבדיקה` : "אין בקשות חדשות"}</p>
        </div>
        <Button icon="qr" onClick={() => setPoster(true)}>
          <span className="hide-mobile">פוסטר הרשמה</span>
          <span className="hide-desktop">פוסטר</span>
        </Button>
      </div>

      <div style={{ marginBottom: 14 }}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "new", label: "חדשות", count: newCount },
            { value: "all", label: "הכל" },
          ]}
        />
      </div>

      {list.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="qr"
            title={filter === "new" ? "אין בקשות חדשות" : "עוד אין בקשות הרשמה"}
            text="תלו את פוסטר ההרשמה בסטודיו או שתפו את הקישור — כל בקשה תגיע לכאן ותיצור ליד למעקב."
            action={<Button onClick={() => setPoster(true)}>לפוסטר ההרשמה</Button>}
          />
        </div>
      ) : (
        <div className="stack-3">
          {list.map((r) => (
            <article key={r.id} className="card card-pad rise-in" style={{ padding: 16 }}>
              <div className="row between start" style={{ gap: 10 }}>
                <div className="row" style={{ gap: 10, minWidth: 0 }}>
                  <Avatar name={r.name} size="sm" />
                  <div style={{ minWidth: 0 }}>
                    <div className="bold truncate">{r.name}</div>
                    <div className="xsmall subtle">
                      <span className="ltr">{fmtPhone(r.phone_e164)}</span> · <span title={fmtDateTime(r.created_at, tz)}>{relTime(r.created_at)}</span>
                    </div>
                  </div>
                </div>
                <Badge tone={r.status === "new" ? "blue" : r.status === "reviewed" ? "green" : "gray"}>{STATUS_LABEL[r.status]}</Badge>
              </div>
              <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
                {r.interest && <span className="fact">{r.interest}</span>}
                <span className="fact">
                  <Icon name={r.contact_allowed ? "whatsapp" : "phone"} size={14} />
                  {r.contact_allowed ? "אישר/ה וואטסאפ" : "ללא אישור וואטסאפ — שיחה בלבד"}
                </span>
              </div>
              {r.note && <p className="small muted" style={{ marginTop: 8 }}>&ldquo;{r.note}&rdquo;</p>}
              {r.matched_existing === 1 && (
                <div className="row xsmall" style={{ color: "var(--orange)", gap: 5, marginTop: 8 }}>
                  <Icon name="info" size={14} /> מספר קיים{r.contact_name ? ` (${r.contact_name})` : ""} — נוצרה משימת בדיקה, הפרטים בתיק לא שונו
                </div>
              )}
              <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
                {canOpenContact && r.contact_id && (
                  <Link href={`/contacts/${r.contact_id}`} className="btn sm">
                    <Icon name="person" size={16} /> לתיק
                  </Link>
                )}
                {staff.length > 0 && r.contact_id && (
                  <Menu
                    trigger={(p) => (
                      <button {...p} className="btn sm ghost">
                        <Icon name="user_plus" size={16} /> שיוך אחראי
                      </button>
                    )}
                  >
                    {staff.map((s) => (
                      <button key={s.id} onClick={() => update(r, { owner_id: s.id }, `שויך ל${s.name}`)}>
                        <Avatar name={s.name} size="sm" /> {s.name}
                      </button>
                    ))}
                  </Menu>
                )}
                {r.status === "new" && (
                  <>
                    <Button size="sm" variant="primary" icon="check" loading={busy === r.id} onClick={() => update(r, { status: "reviewed" }, "סומן כטופל")} style={{ marginInlineStart: "auto" }}>
                      טופל
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => update(r, { status: "rejected" }, "הבקשה נדחתה")}>
                      דחייה
                    </Button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <PosterSheet open={poster} onClose={() => setPoster(false)} slug={slug} studioName={studioName} />
    </div>
  );
}

function PosterSheet({ open, onClose, slug, studioName }: { open: boolean; onClose: () => void; slug: string; studioName: string }) {
  const toast = useToast();
  const [svg, setSvg] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!open) return;
    const u = `${window.location.origin}/s/${slug}`;
    setUrl(u);
    QRCode.toString(u, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then(setSvg).catch(() => setSvg(null));
  }, [open, slug]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast("הקישור הועתק", "success");
    } catch {
      toast("לא הצלחנו להעתיק", "error");
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="פוסטר הרשמה"
      footer={
        <>
          <Button icon="copy" onClick={copy}>
            העתקת קישור
          </Button>
          <Button variant="primary" icon="print" onClick={() => window.print()}>
            הדפסה
          </Button>
        </>
      }
    >
      <div className="print-area">
        <div className="poster card">
          <div className="public-studio">{studioName}</div>
          <h2 style={{ fontSize: 26, margin: "8px 0 4px" }}>רוצים להצטרף?</h2>
          <p className="muted" style={{ marginBottom: 18 }}>
            סרקו את הקוד והשאירו פרטים — נחזור אליכם.
          </p>
          {svg ? <div className="qr-svg" role="img" aria-label="קוד QR לדף ההרשמה" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="skeleton" style={{ width: 240, height: 240, margin: "0 auto" }} />}
          <p className="xsmall subtle ltr" style={{ marginTop: 14, wordBreak: "break-all" }}>
            {url}
          </p>
        </div>
      </div>
      <p className="xsmall subtle" style={{ marginTop: 12 }}>
        הקוד הזה קבוע ומוביל לטופס ההרשמה בלבד. הוא לא משמש לרישום נוכחות.
      </p>
    </Sheet>
  );
}
