"use client";
import "@/app/admin.css";

import { ThemeSegmented } from "../ThemeSwitch";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { RULE_LABEL, ROLE_LABEL, LANG_LABEL } from "@/lib/i18n";
import { relTime } from "@/lib/format";
import { Icon } from "../Icon";
import { Avatar, Badge, Banner, Button, Field, SelectField, Sheet, Switch, Tabs, TextArea, TextField, useConfirm, useToast, cx } from "../ui";

export type SettingsTab = "studio" | "team" | "rules" | "messages" | "qr" | "account";

type RuleKey = "R01" | "R02" | "R03" | "R04" | "R05" | "R06" | "R07";
type Settings = {
  rules: Record<RuleKey, { enabled: boolean; days?: number; threshold?: number }>;
  cooldownHours: number;
  maxContactsPer7Days: number;
  qrRotateSeconds: number;
  checkinWindowBeforeMin: number;
  checkinWindowAfterMin: number;
  messageLanguage: "he" | "ar" | "en";
  studioStyle: string;
  signature: string;
  noticeVersion: string;
  noticeText: string;
  aiMonthlyQuota: number;
  importFreshnessHours: number;
};
type Studio = { name: string; slug: string; timezone: string; modules: string[]; settings: Settings };
type Team = {
  members: { user_id: string; name: string; email: string; role: "owner" | "staff" | "instructor"; scope: string; active: number; created_at: string; last_seen: string | null }[];
  invites: { id: string; email: string; name: string | null; role: string; expires_at: string; created_at: string }[];
};

const TAB_META: Record<SettingsTab, { label: string; icon: string }> = {
  studio: { label: "סטודיו", icon: "settings" },
  team: { label: "צוות והרשאות", icon: "people" },
  rules: { label: "כללי מעקב", icon: "tasks" },
  messages: { label: "הודעות", icon: "message" },
  qr: { label: "QR ונוכחות", icon: "qr" },
  account: { label: "החשבון שלי", icon: "key" },
};

const TIMEZONES = [
  ["Asia/Jerusalem", "ישראל (ירושלים)"],
  ["Asia/Amman", "ירדן (עמאן)"],
  ["Asia/Dubai", "דובאי"],
  ["Europe/London", "לונדון"],
  ["Europe/Paris", "פריז"],
  ["Europe/Berlin", "ברלין"],
  ["Europe/Athens", "אתונה"],
  ["America/New_York", "ניו יורק"],
  ["America/Chicago", "שיקגו"],
  ["America/Los_Angeles", "לוס אנג'לס"],
  ["Australia/Sydney", "סידני"],
  ["UTC", "UTC"],
];

const RULE_HELP: Record<RuleKey, { text: (v: number) => string; field?: "days" | "threshold"; unit?: string; min: number; max: number }> = {
  R01: { text: (v) => `ליד חדש שעוד לא נוצר איתו קשר מאושר. יוצג מיד, ונחשב באיחור אחרי ${v} ימים.`, field: "days", unit: "ימים", min: 0, max: 14 },
  R02: { text: (v) => `היה/תה בשיעור ניסיון לפני ${v} ימים לפחות, בלי מנוי פעיל ובלי סירוב.`, field: "days", unit: "ימים", min: 0, max: 30 },
  R03: { text: (v) => `מנוי פעיל שמסתיים בתוך ${v} ימים, ואין חידוש עתידי מתועד.`, field: "days", unit: "ימים", min: 1, max: 60 },
  R04: { text: (v) => `כרטיסייה בתוקף שנשארו בה ${v} שיעורים או פחות.`, field: "threshold", unit: "שיעורים", min: 1, max: 20 },
  R05: { text: (v) => `מנוי זכאי שלא הגיע/ה ${v} ימים, ואין הקפאה ידועה. לא מופעל כשנתוני הנוכחות לא עדכניים.`, field: "days", unit: "ימים", min: 3, max: 120 },
  R06: { text: () => "משימה ידנית שהגיע מועדה או שהיא באיחור.", min: 0, max: 0 },
  R07: { text: (v) => `מנוי שהסתיים לפני עד ${v} ימים, בלי סירוב ובלי חסימת קשר. כבוי כברירת מחדל.`, field: "days", unit: "ימים", min: 1, max: 90 },
};

const ROLE_HELP: Record<string, string> = {
  owner: "גישה מלאה: לקוחות, מנויים והתאמת יתרה, ייבוא וייצוא, הגדרות ומשתמשים.",
  staff: "לקוחות (כולם או רק המשויכים), הכנת הודעות ותיעוד מעקב, רישום ותיקון נוכחות. בלי הגדרות, ייבוא או התאמת יתרה.",
  instructor: "רישום נוכחות בשיעורים שלו/ה בלבד. בלי גישה לתיקי לקוחות.",
};

function useSave() {
  const router = useRouter();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async (body: unknown) => {
    setSaving(true);
    setErrors({});
    try {
      await api("/api/settings", { method: "PATCH", body });
      toast("ההגדרות נשמרו", "success");
      router.refresh();
      return true;
    } catch (e) {
      const err = e as ApiError;
      if (err.fields) setErrors(err.fields);
      toast(err.message, "error");
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { save, saving, errors };
}

function NumField({ value, onChange, min, max, label, error, unit }: { value: number; onChange: (v: number) => void; min: number; max: number; label: string; error?: string; unit?: string }) {
  return (
    <div className="col" style={{ gap: 4, alignItems: "flex-end", flex: "none" }}>
      <div className="row" style={{ gap: 6 }}>
        <input
          className="input sm num-input num"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          style={{ width: 80 }}
        />
        {unit && <span className="small muted">{unit}</span>}
      </div>
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

function Section({ title, sub, children, footer }: { title: string; sub?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section className="card fade-in">
      <div className="card-head" style={{ display: "block" }}>
        <h2 className="card-title">{title}</h2>
        {sub && <p className="small muted" style={{ marginTop: 2 }}>{sub}</p>}
      </div>
      {children}
      {footer && (
        <div className="row" style={{ justifyContent: "flex-end", padding: "12px 20px", borderTop: "1px solid var(--line)" }}>
          {footer}
        </div>
      )}
    </section>
  );
}

export function SettingsView({
  tabs,
  initialTab,
  studio,
  team,
  me,
  aiConfigured,
  templates,
}: {
  tabs: SettingsTab[];
  initialTab: SettingsTab;
  studio: Studio | null;
  team: Team | null;
  me: { id: string; name: string; email: string; role: string };
  aiConfigured: boolean;
  templates: { rule: string; text: string }[];
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const go = (t: SettingsTab) => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url.toString());
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{tabs.length > 1 ? "הגדרות" : "החשבון שלי"}</h1>
          {studio && <p className="page-sub">{studio.name}</p>}
        </div>
      </div>
      {tabs.length > 1 && (
        <div className="hide-desktop" style={{ marginBottom: 16 }}>
          <Tabs value={tab} onChange={go} tabs={tabs.map((t) => ({ value: t, label: TAB_META[t].label }))} label="אזורי הגדרות" />
        </div>
      )}
      <div className={tabs.length > 1 ? "settings-layout" : undefined}>
        {tabs.length > 1 && (
          <nav className="settings-nav" aria-label="אזורי הגדרות">
            {tabs.map((t) => (
              <button key={t} type="button" className="nav-item" aria-current={tab === t ? "page" : undefined} onClick={() => go(t)} style={{ border: 0, background: tab === t ? undefined : "none", cursor: "pointer", width: "100%" }}>
                <Icon name={TAB_META[t].icon} size={18} />
                <span>{TAB_META[t].label}</span>
              </button>
            ))}
          </nav>
        )}
        <div className="stack-4" key={tab}>
          {tab === "studio" && studio && <StudioSection studio={studio} />}
          {tab === "team" && team && <TeamSection initial={team} meId={me.id} />}
          {tab === "rules" && studio && <RulesSection settings={studio.settings} />}
          {tab === "messages" && studio && <MessagesSection settings={studio.settings} aiConfigured={aiConfigured} templates={templates} hasAi={studio.modules.includes("ai")} />}
          {tab === "qr" && studio && <QrSection settings={studio.settings} slug={studio.slug} />}
          {tab === "account" && <AccountSection me={me} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Studio

function StudioSection({ studio }: { studio: Studio }) {
  const { save, saving, errors } = useSave();
  const [name, setName] = useState(studio.name);
  const [tz, setTz] = useState(studio.timezone);
  const [mods, setMods] = useState<string[]>(studio.modules);
  const toggle = (m: string, on: boolean) => setMods((x) => (on ? [...new Set([...x, m])] : x.filter((y) => y !== m)));
  const tzOptions = TIMEZONES.some(([v]) => v === tz) ? TIMEZONES : [[tz, tz], ...TIMEZONES];
  return (
    <>
      <Section title="פרטי הסטודיו" footer={<Button variant="primary" loading={saving} onClick={() => save({ name, timezone: tz, modules: mods })}>שמירה</Button>}>
        <div className="card-pad stack-4">
          <TextField label="שם הסטודיו" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
          <SelectField
            label="אזור זמן"
            hint="כל התאריכים, סוף היום ותוקף המנויים מחושבים לפי אזור הזמן של הסטודיו."
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            error={errors.timezone}
            options={tzOptions.map(([v, l]) => ({ value: v, label: l }))}
          />
        </div>
      </Section>
      <Section title="מודולים" sub="מה מופעל בסטודיו. כיבוי מודול מסתיר את המסכים שלו, בלי למחוק נתונים.">
        <div className="set-row">
          <div className="grow">
            <div className="bold set-label">ניהול לקוחות (CRM)</div>
            <div className="small muted">תיקי לקוחות, שלבים, משימות והיסטוריה. תמיד פעיל.</div>
          </div>
          <Switch checked label="ניהול לקוחות" onChange={() => {}} disabled />
        </div>
        <div className="set-row">
          <div className="grow">
            <div className="bold set-label">מעקב והודעות</div>
            <div className="small muted">רשימת המעקב היומית לפי כללים, הכנת הודעה לוואטסאפ ותיעוד התוצאה.</div>
          </div>
          <Switch checked={mods.includes("ai")} label="מעקב והודעות" onChange={(v) => toggle("ai", v)} />
        </div>
        <div className="set-row">
          <div className="grow">
            <div className="bold set-label">הרשמה ונוכחות ב-QR</div>
            <div className="small muted">טופס הרשמה ציבורי, יומן שיעורים ונוכחות בסריקה. מתאים לסטודיו בלי אפליקציית הזמנות.</div>
          </div>
          <Switch checked={mods.includes("qr")} label="הרשמה ונוכחות ב-QR" onChange={(v) => toggle("qr", v)} />
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- Team

function CopyLink({ url, label }: { url: string; label: string }) {
  const toast = useToast();
  return (
    <div className="stack-2">
      <div className="link-box">
        <code>{url}</code>
      </div>
      <div className="row wrap">
        <Button
          size="sm"
          icon="copy"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              toast("הקישור הועתק", "success");
            } catch {
              toast("לא הצלחנו להעתיק. סמנו והעתיקו ידנית.", "error");
            }
          }}
        >
          העתקת הקישור
        </Button>
        <a className="btn sm whatsapp" href={`https://wa.me/?text=${encodeURIComponent(`${label}\n${url}`)}`} target="_blank" rel="noreferrer">
          <Icon name="whatsapp" size={16} /> <span>שליחה בוואטסאפ</span>
        </a>
      </div>
    </div>
  );
}

function TeamSection({ initial, meId }: { initial: Team; meId: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [team, setTeam] = useState(initial);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [link, setLink] = useState<{ title: string; url: string; label: string } | null>(null);
  const reload = async () => setTeam(await api<Team>("/api/team"));

  const patch = async (userId: string, body: Record<string, unknown>, msg = "עודכן") => {
    try {
      await api(`/api/team/${userId}`, { method: "PATCH", body });
      toast(msg, "success");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const deactivate = async (m: Team["members"][number]) => {
    const okd = await confirm({
      title: `להשבית את ${m.name}?`,
      body: "הגישה תיחסם מייד וכל ההתחברויות יבוטלו. ההיסטוריה והמשימות נשמרות, ואפשר להחזיר את הגישה בהמשך.",
      confirm: "השבתה",
      danger: true,
    });
    if (okd) patch(m.user_id, { active: false }, "המשתמש הושבת");
  };
  const resetLink = async (m: Team["members"][number]) => {
    try {
      const r = await api<{ token: string }>(`/api/team/${m.user_id}/reset-link`, { method: "POST" });
      setLink({ title: `קישור לסיסמה חדשה · ${m.name}`, url: `${window.location.origin}/reset/${r.token}`, label: "קישור לבחירת סיסמה חדשה ב-StudioMate (תקף ל-24 שעות):" });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const revoke = async (id: string) => {
    try {
      await api(`/api/team/invites/${id}`, { method: "DELETE" });
      toast("ההזמנה בוטלה", "success");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <>
      <Section title="צוות" sub="ההרשאות נאכפות בשרת בכל פעולה, לא רק בהסתרת כפתורים.">
        <div>
          {team.members.map((m) => (
            <div key={m.user_id} className={cx("set-row", !m.active && "disabled")} style={{ flexWrap: "wrap" }}>
              <Avatar name={m.name} size="sm" />
              <div className="grow" style={{ minWidth: 160 }}>
                <div className="bold set-label">
                  {m.name} {m.user_id === meId && <span className="xsmall subtle">(את/ה)</span>}
                </div>
                <div className="xsmall subtle ltr" style={{ textAlign: "right" }}>
                  {m.email}
                </div>
                <div className="xsmall subtle">{m.active ? (m.last_seen ? `פעילות אחרונה ${relTime(m.last_seen)}` : "עוד לא התחבר/ה") : "מושבת/ת"}</div>
              </div>
              {m.active ? (
                <div className="row wrap" style={{ gap: 6 }}>
                  <select className="select sm" style={{ width: "auto" }} value={m.role} onChange={(e) => patch(m.user_id, { role: e.target.value }, "התפקיד עודכן")} aria-label={`תפקיד של ${m.name}`}>
                    {(["owner", "staff", "instructor"] as const).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  {m.role === "staff" && (
                    <select className="select sm" style={{ width: "auto" }} value={m.scope} onChange={(e) => patch(m.user_id, { scope: e.target.value }, "הגישה עודכנה")} aria-label={`גישה ללקוחות של ${m.name}`}>
                      <option value="all">כל הלקוחות</option>
                      <option value="assigned">רק משויכים</option>
                    </select>
                  )}
                  <Button size="sm" variant="ghost" icon="key" onClick={() => resetLink(m)}>
                    <span className="hide-mobile">קישור לסיסמה חדשה</span>
                  </Button>
                  {m.user_id !== meId && <Button size="sm" variant="ghost" icon="ban" aria-label="השבתה" onClick={() => deactivate(m)} />}
                </div>
              ) : (
                <Button size="sm" onClick={() => patch(m.user_id, { active: true }, "הגישה הוחזרה")}>
                  החזרת גישה
                </Button>
              )}
            </div>
          ))}
        </div>
        <div className="row" style={{ justifyContent: "flex-end", padding: "12px 20px", borderTop: "1px solid var(--line)" }}>
          <Button variant="primary" icon="user_plus" onClick={() => setInviteOpen(true)}>
            הזמנת איש צוות
          </Button>
        </div>
      </Section>

      {team.invites.length > 0 && (
        <Section title="הזמנות שממתינות">
          {team.invites.map((i) => (
            <div key={i.id} className="set-row">
              <Icon name="link" size={18} />
              <div className="grow">
                <div className="bold ltr" style={{ textAlign: "right" }}>
                  {i.email}
                </div>
                <div className="xsmall subtle">
                  {ROLE_LABEL[i.role]} · תוקף {relTime(i.expires_at)}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => revoke(i.id)}>
                ביטול
              </Button>
            </div>
          ))}
        </Section>
      )}

      <div className="card card-pad small muted stack-2">
        <div className="bold" style={{ color: "var(--text)" }}>
          מה כל תפקיד יכול לעשות
        </div>
        {(["owner", "staff", "instructor"] as const).map((r) => (
          <p key={r}>
            <span className="bold" style={{ color: "var(--text)" }}>
              {ROLE_LABEL[r]}:
            </span>{" "}
            {ROLE_HELP[r]}
          </p>
        ))}
        <p className="xsmall subtle">גישת תמיכה טכנית אינה אוטומטית: היא תתאפשר בעתיד רק באישורך, מוגבלת בזמן ומתועדת ביומן.</p>
      </div>

      <InviteSheet
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={async (url, email) => {
          setInviteOpen(false);
          setLink({ title: `הזמנה ל-${email}`, url, label: "הוזמנת להצטרף לצוות הסטודיו ב-StudioMate (הקישור תקף ל-7 ימים):" });
          await reload();
        }}
      />

      <Sheet open={!!link} onClose={() => setLink(null)} title={link?.title ?? ""} footer={<Button variant="primary" onClick={() => setLink(null)}>סיום</Button>}>
        {link && (
          <div className="stack-3">
            <p className="small muted">הקישור מוצג פעם אחת בלבד ואפשר להשתמש בו פעם אחת. שלחו אותו ישירות לאדם הנכון — לא בקבוצה.</p>
            <CopyLink url={link.url} label={link.label} />
          </div>
        )}
      </Sheet>
    </>
  );
}

function InviteSheet({ open, onClose, onInvited }: { open: boolean; onClose: () => void; onInvited: (url: string, email: string) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"owner" | "staff" | "instructor">("staff");
  const [scope, setScope] = useState<"all" | "assigned">("all");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setEmail("");
      setName("");
      setRole("staff");
      setScope("all");
      setErrors({});
    }
  }, [open]);
  const submit = async () => {
    setSaving(true);
    setErrors({});
    try {
      const r = await api<{ token: string }>("/api/team/invites", { body: { email, name, role, scope } });
      onInvited(`${window.location.origin}/invite/${r.token}`, email);
    } catch (e) {
      const err = e as ApiError;
      setErrors(err.fields ?? { email: err.message });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="הזמנת איש צוות"
      footer={
        <>
          <Button onClick={onClose}>ביטול</Button>
          <Button variant="primary" loading={saving} onClick={submit}>
            יצירת קישור הזמנה
          </Button>
        </>
      }
    >
      <div className="stack-4">
        <TextField label="אימייל" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} autoFocus />
        <TextField label="שם" optional value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="תפקיד" error={errors.role}>
          <div className="radio-cards">
            {(["staff", "instructor", "owner"] as const).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={role === r} className="radio-card" onClick={() => setRole(r)}>
                <span className="radio-dot" />
                <span className="grow">
                  <span className="bold">{ROLE_LABEL[r]}</span>
                  <span className="xsmall muted" style={{ display: "block" }}>
                    {ROLE_HELP[r]}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Field>
        {role === "staff" && (
          <SelectField
            label="גישה ללקוחות"
            value={scope}
            onChange={(e) => setScope(e.target.value as "all" | "assigned")}
            options={[
              { value: "all", label: "כל הלקוחות בסטודיו" },
              { value: "assigned", label: "רק לקוחות שמשויכים אליו/ה" },
            ]}
          />
        )}
        <p className="xsmall subtle">אין שליחת אימייל אוטומטית: אחרי היצירה יוצג קישור אישי להעתקה או לשליחה בוואטסאפ.</p>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Rules

function RulesSection({ settings }: { settings: Settings }) {
  const { save, saving, errors } = useSave();
  const [rules, setRules] = useState(settings.rules);
  const [cooldown, setCooldown] = useState(settings.cooldownHours);
  const [maxContacts, setMaxContacts] = useState(settings.maxContactsPer7Days);
  const [freshness, setFreshness] = useState(settings.importFreshnessHours);
  const setRule = (k: RuleKey, patch: Partial<Settings["rules"][RuleKey]>) => setRules((r) => ({ ...r, [k]: { ...r[k], ...patch } }));
  const ruleErrors: Record<string, string> = {};
  for (const k of Object.keys(rules) as RuleKey[]) {
    const h = RULE_HELP[k];
    if (!h.field) continue;
    const v = rules[k][h.field];
    if (v === undefined || !Number.isFinite(v) || v < h.min || v > h.max) ruleErrors[k] = `בין ${h.min} ל-${h.max}`;
  }
  const valid = Object.keys(ruleErrors).length === 0;
  return (
    <>
      <Banner tone="info">אלה ערכי פתיחה לפיילוט. כדאי לבדוק אותם עם הצוות אחרי כמה שבועות ולעדכן לפי מה שעובד.</Banner>
      <Section title="מתי לקוח מופיע ברשימת היום" sub="הכללים קובעים מי זקוק למעקב. עוזר הניסוח רק עוזר לנסח את ההודעה.">
        {(Object.keys(RULE_HELP) as RuleKey[]).map((k) => {
          const h = RULE_HELP[k];
          const r = rules[k] ?? { enabled: false };
          const v = h.field ? (r[h.field] ?? 0) : 0;
          return (
            <div key={k} className={cx("set-row", !r.enabled && "disabled")} style={{ alignItems: "flex-start" }}>
              <div className="grow stack-2">
                <div>
                  <div className="bold set-label">{RULE_LABEL[k]}</div>
                  <div className="small muted">{h.text(v)}</div>
                </div>
                {h.field && r.enabled && (
                  <div className="row fade-in" style={{ gap: 8 }}>
                    <span className="small muted">{h.field === "threshold" ? "סף:" : "מספר ימים:"}</span>
                    <NumField value={v} min={h.min} max={h.max} unit={h.unit} label={`${RULE_LABEL[k]} — ${h.unit}`} error={ruleErrors[k]} onChange={(n) => setRule(k, { [h.field!]: n })} />
                  </div>
                )}
              </div>
              <Switch checked={r.enabled} label={RULE_LABEL[k]} onChange={(on) => setRule(k, { enabled: on })} />
            </div>
          );
        })}
      </Section>
      <Section
        title="שמירה על הלקוחות מפניות מיותרות"
        sub="בקשה של לקוח להפסיק קשר קודמת תמיד לכל כלל."
        footer={
          <Button variant="primary" loading={saving} disabled={!valid} onClick={() => save({ settings: { rules, cooldownHours: cooldown, maxContactsPer7Days: maxContacts, importFreshnessHours: freshness } })}>
            שמירת הכללים
          </Button>
        }
      >
        <div className="set-row wrap-mobile">
          <div className="grow">
            <div className="bold">זמן המתנה בין פניות</div>
            <div className="small muted">אחרי הודעה שנשלחה, הלקוח לא יופיע שוב ברשימה עד שיעבור הזמן הזה.</div>
          </div>
          <NumField value={cooldown} min={0} max={720} unit="שעות" label="זמן המתנה בשעות" error={errors.cooldownHours} onChange={setCooldown} />
        </div>
        <div className="set-row wrap-mobile">
          <div className="grow">
            <div className="bold">מקסימום פניות בשבוע</div>
            <div className="small muted">מספר הפניות השיווקיות ללקוח אחד בתוך 7 ימים.</div>
          </div>
          <NumField value={maxContacts} min={1} max={20} unit="פניות" label="מקסימום פניות ב-7 ימים" error={errors.maxContactsPer7Days} onChange={setMaxContacts} />
        </div>
        <div className="set-row wrap-mobile">
          <div className="grow">
            <div className="bold">תוקף נתונים מיובאים</div>
            <div className="small muted">אחרי הזמן הזה בלי ייבוא חדש, כללים שתלויים במנויים מיובאים מושהים ומוצגת אזהרה.</div>
          </div>
          <NumField value={freshness} min={1} max={2160} unit="שעות" label="תוקף נתונים מיובאים בשעות" error={errors.importFreshnessHours} onChange={setFreshness} />
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- Messages

function MessagesSection({ settings, aiConfigured, templates, hasAi }: { settings: Settings; aiConfigured: boolean; templates: { rule: string; text: string }[]; hasAi: boolean }) {
  const { save, saving, errors } = useSave();
  const [lang, setLang] = useState(settings.messageLanguage);
  const [style, setStyle] = useState(settings.studioStyle);
  const [signature, setSignature] = useState(settings.signature);
  const [quota, setQuota] = useState(settings.aiMonthlyQuota);
  return (
    <>
      <Section title="עוזר הניסוח">
        <div className="set-row">
          <span className="tl-icon" style={{ background: aiConfigured ? "var(--green-soft)" : "var(--surface-3)", color: aiConfigured ? "var(--green)" : "var(--text-2)" }}>
            <Icon name="sparkle" size={17} />
          </span>
          <div className="grow">
            <div className="bold">{aiConfigured ? "מחובר" : "לא מחובר — משתמשים בתבניות קבועות"}</div>
            <div className="small muted">
              {aiConfigured
                ? "הצעות ההודעה מנוסחות לפי מצב הלקוח. העובד תמיד בודק ועורך לפני שליחה. טלפונים, הערות פרטיות ומידע רגיש לא נשלחים."
                : "כדי להפעיל ניסוח חכם, האחראי הטכני צריך להגדיר מפתח שירות בשרת. עד אז כל הודעה מוכנה מתבנית בטוחה שאפשר לערוך."}
            </div>
          </div>
          {hasAi && <Badge tone={aiConfigured ? "green" : "gray"} dot>{aiConfigured ? "פעיל" : "תבניות"}</Badge>}
        </div>
      </Section>
      <Section
        title="סגנון ההודעות"
        footer={
          <Button variant="primary" loading={saving} onClick={() => save({ settings: { messageLanguage: lang, studioStyle: style, signature, aiMonthlyQuota: quota } })}>
            שמירה
          </Button>
        }
      >
        <div className="card-pad stack-4">
          <SelectField
            label="שפת ברירת מחדל להודעות"
            hint="אם ללקוח מוגדרת שפה מועדפת — ההודעה תוכן בשפה שלו."
            value={lang}
            onChange={(e) => setLang(e.target.value as Settings["messageLanguage"])}
            error={errors.messageLanguage}
            options={(["he", "ar", "en"] as const).map((l) => ({ value: l, label: LANG_LABEL[l] }))}
          />
          <TextArea label="איך הסטודיו מדבר?" hint="תיאור קצר לעוזר הניסוח, למשל: חם, אישי, בלי לחץ. עד 300 תווים." rows={2} maxLength={300} value={style} onChange={(e) => setStyle(e.target.value)} />
          <TextField label="חתימה" optional hint="תתווסף בסוף כל הודעה, למשל: מאיה, סטודיו נשימה" maxLength={80} value={signature} onChange={(e) => setSignature(e.target.value)} />
          <Field label="מכסת הצעות בחודש" hint="כשהמכסה נגמרת ממשיכים עם תבניות קבועות. שום דבר אחר לא נחסם." error={errors.aiMonthlyQuota}>
            <input className="input num" type="number" inputMode="numeric" min={0} value={Number.isFinite(quota) ? quota : ""} onChange={(e) => setQuota(e.target.value === "" ? NaN : Number(e.target.value))} style={{ maxWidth: 160 }} />
          </Field>
        </div>
      </Section>
      {templates.length > 0 && (
        <Section title="התבניות הקבועות" sub="כך נראית הודעה כשעוזר הניסוח לא זמין (דוגמה עם נתונים לדוגמה).">
          <div className="card-pad stack-4">
            {templates.map((t) => (
              <div key={t.rule} className="stack-2">
                <div className="small bold">{RULE_LABEL[t.rule]}</div>
                <div className="bubble" dir={settings.messageLanguage === "en" ? "ltr" : "rtl"}>
                  {t.text}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------- QR

function QrSection({ settings, slug }: { settings: Settings; slug: string }) {
  const { save, saving, errors } = useSave();
  const [rotate, setRotate] = useState(settings.qrRotateSeconds);
  const [before, setBefore] = useState(settings.checkinWindowBeforeMin);
  const [after, setAfter] = useState(settings.checkinWindowAfterMin);
  const [notice, setNotice] = useState(settings.noticeText);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return (
    <>
      <Section title="טופס הרשמה ציבורי" sub="הקישור שמאחורי ה-QR של הסטודיו. אפשר להדפיס את הקוד מתוך 'בקשות הרשמה'.">
        <div className="card-pad stack-3">
          <div className="link-box">
            <code>{origin ? `${origin}/s/${slug}` : `/s/${slug}`}</code>
          </div>
          <div className="row wrap">
            <a href={`/s/${slug}`} target="_blank" rel="noreferrer" className="btn sm">
              <Icon name="eye" size={16} /> <span>פתיחת הטופס</span>
            </a>
          </div>
        </div>
      </Section>
      <Section
        title="נוכחות בסריקה"
        footer={
          <Button variant="primary" loading={saving} onClick={() => save({ settings: { qrRotateSeconds: rotate, checkinWindowBeforeMin: before, checkinWindowAfterMin: after, noticeText: notice } })}>
            שמירה
          </Button>
        }
      >
        <div className="set-row wrap-mobile">
          <div className="grow">
            <div className="bold">החלפת הקוד על המסך</div>
            <div className="small muted">הקוד מתחלף כל כמה שניות, כדי שצילום ישן לא יעבוד מהבית.</div>
          </div>
          <NumField value={rotate} min={15} max={600} unit="שניות" label="החלפת קוד בשניות" error={errors.qrRotateSeconds} onChange={setRotate} />
        </div>
        <div className="set-row wrap-mobile">
          <div className="grow">
            <div className="bold">פתיחת הרישום לפני השיעור</div>
            <div className="small muted">כמה דקות לפני תחילת השיעור אפשר לסרוק.</div>
          </div>
          <NumField value={before} min={0} max={180} unit="דקות" label="דקות לפני השיעור" error={errors.checkinWindowBeforeMin} onChange={setBefore} />
        </div>
        <div className="set-row wrap-mobile">
          <div className="grow">
            <div className="bold">סגירת הרישום אחרי ההתחלה</div>
            <div className="small muted">אחרי זה רק עובד/ת יכול/ה לרשום נוכחות ידנית.</div>
          </div>
          <NumField value={after} min={0} max={180} unit="דקות" label="דקות אחרי תחילת השיעור" error={errors.checkinWindowAfterMin} onChange={setAfter} />
        </div>
        <div className="card-pad" style={{ borderTop: "1px solid var(--line)" }}>
          <TextArea
            label="הסבר על השימוש בפרטים (מוצג בטופס ההרשמה)"
            hint={`גרסה נוכחית: ${settings.noticeVersion}. כל שינוי בנוסח יוצר גרסה חדשה, והגרסה נשמרת עם כל הרשמה. מומלץ לאשר את הנוסח מול מי שאחראי/ת על פרטיות.`}
            rows={3}
            maxLength={600}
            value={notice}
            onChange={(e) => setNotice(e.target.value)}
          />
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- Account

function AccountSection({ me }: { me: { name: string; email: string; role: string } }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirmPw) return setErrors({ confirm: "הסיסמאות לא זהות." });
    setSaving(true);
    setErrors({});
    try {
      await api("/api/account/password", { body: { current, next } });
      toast("הסיסמה עודכנה", "success");
      setCurrent("");
      setNext("");
      setConfirmPw("");
    } catch (er) {
      const err = er as ApiError;
      setErrors(err.fields ?? {});
      if (!err.fields) toast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Section title="פרטים">
        <div className="set-row">
          <Avatar name={me.name} />
          <div className="grow">
            <div className="bold">{me.name}</div>
            <div className="small muted ltr" style={{ textAlign: "right" }}>
              {me.email}
            </div>
          </div>
          <Badge>{me.role}</Badge>
        </div>
      </Section>
      <Section title="מראה" sub="בהיר, כהה, או לפי הגדרות המכשיר. נשמר בדפדפן הזה.">
        <div className="card-pad">
          <ThemeSegmented block showLabels />
        </div>
      </Section>
      <section className="card fade-in">
        <div className="card-head" style={{ display: "block" }}>
          <h2 className="card-title">שינוי סיסמה</h2>
          <p className="small muted" style={{ marginTop: 2 }}>
            אחרי השינוי, כל המכשירים האחרים שמחוברים לחשבון ינותקו.
          </p>
        </div>
        <form className="card-pad stack-4" onSubmit={submit} noValidate>
          <input type="text" autoComplete="username" value={me.email} readOnly hidden />
          <TextField label="סיסמה נוכחית" type="password" autoComplete="current-password" dir="ltr" value={current} onChange={(e) => setCurrent(e.target.value)} error={errors.current} />
          <TextField label="סיסמה חדשה" type="password" autoComplete="new-password" dir="ltr" hint="10 תווים לפחות" value={next} onChange={(e) => setNext(e.target.value)} error={errors.next} />
          <TextField label="שוב את הסיסמה החדשה" type="password" autoComplete="new-password" dir="ltr" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} error={errors.confirm} />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button type="submit" variant="primary" loading={saving} disabled={!current || !next}>
              עדכון הסיסמה
            </Button>
          </div>
        </form>
      </section>
    </>
  );
}
