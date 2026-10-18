"use client";
import "@/app/admin.css";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { fmtDateTime, relTime } from "@/lib/format";
import { Icon } from "../Icon";
import { Badge, Banner, Button, EmptyState, useToast } from "../ui";

type Item = { id: string; action: string; entity: string; entity_id: string | null; reason: string | null; diff: string | null; created_at: string; actor: string | null };
type Log = { items: Item[]; total: number; page: number };
type Health = {
  aiByDay: { day: string; drafts: number; fallbacks: number; avg_ms: number | null }[];
  lateTasks: number;
  pendingReconciliation: number;
  connections: { provider: string; name: string; status: string; last_success_at: string | null; last_error: string | null }[];
};

const ACTION_LABEL: Record<string, string> = {
  "auth.login": "כניסה למערכת",
  "studio.created": "הסטודיו נוצר",
  "settings.updated": "ההגדרות עודכנו",
  "user.invited": "נשלחה הזמנה לצוות",
  "user.joined": "איש צוות הצטרף",
  "user.permissions_changed": "שינוי הרשאות",
  "user.reset_link_created": "נוצר קישור לסיסמה חדשה",
  "contact.phone_changed": "שינוי טלפון",
  "contact.merged": "מיזוג תיקים",
  "contacts.exported": "ייצוא לקוחות",
  "preference.allowed": "אושרה יצירת קשר",
  "preference.blocked": "נחסמה יצירת קשר",
  "membership.created": "נוצר מנוי",
  "membership.renewed": "חידוש מנוי",
  "membership.paused": "הקפאת מנוי",
  "membership.cancelled": "ביטול מנוי",
  "balance.adjusted": "התאמת יתרה",
  "attendance.reversed": "ביטול נוכחות",
  "attendance.late_recorded": "רישום נוכחות מאוחר",
  "attendance.exported": "ייצוא נוכחות",
  "session.rescheduled": "שינוי שעות שיעור",
  "session.cancelled": "ביטול שיעור",
  "import.committed": "ייבוא קובץ",
  "import.rolled_back": "ביטול ייבוא",
  "member.activation_created": "נוצר קישור הפעלה לנוכחות",
  "member.sessions_revoked": "נותקו מכשירי נוכחות",
  "task.override_created": "מעקב חריג (מעבר להמתנה)",
  "followup.cooldown_override": "הודעה למרות תקופת המתנה",
};

const ENTITY_LINK: Record<string, (id: string) => string> = {
  contact: (id) => `/contacts/${id}`,
  class_session: (id) => `/sessions/${id}`,
};

const FILTERS = [
  { v: "", l: "הכל" },
  { v: "contact", l: "לקוחות" },
  { v: "preference", l: "העדפות קשר" },
  { v: "membership", l: "מנויים" },
  { v: "balance", l: "יתרות" },
  { v: "attendance", l: "נוכחות" },
  { v: "session", l: "שיעורים" },
  { v: "import", l: "ייבוא" },
  { v: "user", l: "צוות" },
  { v: "settings", l: "הגדרות" },
  { v: "auth", l: "כניסות" },
];

const ICON: Record<string, string> = { contact: "person", preference: "ban", membership: "card", balance: "wallet", attendance: "checkCircle", session: "calendar", import: "upload", user: "people", settings: "settings", auth: "key", followup: "message", task: "tasks", member: "smartphone", contacts: "download", studio: "settings" };

export function AuditView({ initial, health, tz, quota }: { initial: Log; health: Health; tz: string; quota: number }) {
  const toast = useToast();
  const [log, setLog] = useState(initial);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (action: string, page: number) => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ page: String(page) });
      if (action) q.set("action", `${action}.`);
      setLog(await api<Log>(`/api/audit?${q}`));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  const aiDrafts = health.aiByDay.reduce((s, d) => s + (d.drafts ?? 0), 0);
  const aiFallbacks = health.aiByDay.reduce((s, d) => s + (d.fallbacks ?? 0), 0);
  const msVals = health.aiByDay.filter((d) => d.avg_ms).map((d) => d.avg_ms!);
  const avgMs = msVals.length ? Math.round(msVals.reduce((a, b) => a + b, 0) / msVals.length) : null;
  const pages = Math.max(1, Math.ceil(log.total / 50));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">יומן ותפעול</h1>
          <p className="page-sub">שינויים רגישים, תקלות ושימוש בעוזר הניסוח.</p>
        </div>
      </div>

      <h2 className="section-title">מצב המערכת</h2>
      <div className="kpi-grid" style={{ marginBottom: 12 }}>
        <div className="stat">
          <div className="stat-value" style={{ color: health.lateTasks ? "var(--orange)" : undefined }}>
            {health.lateTasks}
          </div>
          <div className="stat-label">משימות באיחור של יותר מיומיים</div>
          {health.lateTasks > 0 && (
            <Link href="/tasks" className="kpi-note" style={{ color: "var(--accent)" }}>
              למשימות ←
            </Link>
          )}
        </div>
        <div className="stat">
          <div className="stat-value" style={{ color: health.pendingReconciliation ? "var(--orange)" : undefined }}>
            {health.pendingReconciliation}
          </div>
          <div className="stat-label">נוכחויות שממתינות לאישור מערכת חיצונית</div>
          <div className="kpi-note">לא מורידים להן יתרה מקומית</div>
        </div>
        <div className="stat">
          <div className="stat-value num">
            {aiDrafts}
            <span className="small subtle"> / {quota}</span>
          </div>
          <div className="stat-label">הצעות ניסוח ב-30 יום</div>
          <div className="kpi-note">
            {aiFallbacks} תבניות חלופיות{avgMs ? ` · זמן ממוצע ${(avgMs / 1000).toFixed(1)} שנ׳` : ""}
          </div>
        </div>
      </div>
      <div className="list" style={{ marginBottom: 28 }}>
        {health.connections.map((c) => (
          <div key={c.provider} className="list-item">
            <Icon name={c.provider === "csv" ? "upload" : "plug"} size={19} />
            <div className="grow">
              <div className="bold">{c.name}</div>
              <div className="xsmall subtle">{c.last_success_at ? `הצלחה אחרונה ${relTime(c.last_success_at)}` : "לא היה עדכון מוצלח"}</div>
              {c.last_error && <div className="xsmall" style={{ color: "var(--red)" }}>{c.last_error}</div>}
            </div>
            <Badge tone={c.status === "active" ? "green" : c.status === "error" ? "red" : "gray"} dot>
              {c.status === "active" ? "פעיל" : c.status === "error" ? "תקלה" : "לא מחובר"}
            </Badge>
          </div>
        ))}
      </div>

      <div className="row between wrap" style={{ marginBottom: 12, gap: 8 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          יומן שינויים
        </h2>
        <span className="xsmall subtle">{log.total} רשומות</span>
      </div>
      <div className="chips" style={{ marginBottom: 12 }} role="group" aria-label="סינון לפי סוג">
        {FILTERS.map((f) => (
          <button
            key={f.v}
            className="chip"
            aria-pressed={filter === f.v}
            onClick={() => {
              setFilter(f.v);
              load(f.v, 1);
            }}
          >
            {f.l}
          </button>
        ))}
      </div>

      {log.items.length === 0 ? (
        <div className="card">
          <EmptyState icon="shield" title="אין רשומות" text="פעולות רגישות כמו מיזוג, שינוי טלפון, התאמת יתרה וביטול נוכחות יופיעו כאן." />
        </div>
      ) : (
        <div className="list" style={{ opacity: loading ? 0.55 : 1, transition: "opacity 200ms" }}>
          {log.items.map((it) => {
            const prefix = it.action.split(".")[0];
            const link = it.entity_id && ENTITY_LINK[it.entity] ? ENTITY_LINK[it.entity](it.entity_id) : null;
            let diff: string | null = null;
            if (it.diff) {
              try {
                diff = JSON.stringify(JSON.parse(it.diff), null, 2);
              } catch {
                diff = it.diff;
              }
            }
            const expandable = !!diff;
            return (
              <div key={it.id} className="list-item" style={{ alignItems: "flex-start" }}>
                <span className="tl-icon">
                  <Icon name={ICON[prefix] ?? "info"} size={16} />
                </span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row between wrap" style={{ gap: 6 }}>
                    <span className="bold">{ACTION_LABEL[it.action] ?? it.action}</span>
                    <span className="xsmall subtle" title={it.created_at}>
                      {fmtDateTime(it.created_at, tz)}
                    </span>
                  </div>
                  <div className="xsmall subtle">
                    {it.actor ?? "מערכת"}
                    {link && (
                      <>
                        {" · "}
                        <Link href={link} style={{ color: "var(--accent)" }}>
                          לפריט
                        </Link>
                      </>
                    )}
                  </div>
                  {it.reason && <div className="small" style={{ marginTop: 4 }}>סיבה: {it.reason}</div>}
                  {expandable && (
                    <button type="button" className="row xsmall" style={{ background: "none", border: 0, padding: 0, marginTop: 4, color: "var(--accent)", cursor: "pointer" }} aria-expanded={open === it.id} onClick={() => setOpen(open === it.id ? null : it.id)}>
                      {open === it.id ? "הסתרת פרטים" : "פרטי השינוי"}
                      <Icon name="chevronDown" size={14} style={{ transform: open === it.id ? "rotate(180deg)" : undefined }} />
                    </button>
                  )}
                  {open === it.id && diff && <pre className="diff-pre fade-in">{diff}</pre>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pages > 1 && (
        <div className="row" style={{ justifyContent: "center", marginTop: 16, gap: 12 }}>
          <Button size="sm" disabled={log.page <= 1 || loading} onClick={() => load(filter, log.page - 1)}>
            הקודם
          </Button>
          <span className="small muted num">
            עמוד {log.page} מתוך {pages}
          </span>
          <Button size="sm" disabled={log.page >= pages || loading} onClick={() => load(filter, log.page + 1)}>
            הבא
          </Button>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <Banner tone="info">
          היומן נשמר לצורך בקרה ואינו ניתן לעריכה. גישת תמיכה טכנית לתוכן הלקוחות אינה אוטומטית — היא תתאפשר רק באישור הבעלים, מוגבלת בזמן ותתועד כאן.
        </Banner>
      </div>
    </div>
  );
}
