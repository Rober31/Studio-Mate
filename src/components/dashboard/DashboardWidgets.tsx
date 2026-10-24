"use client";
import "@/app/dashboard.css";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../Icon";
import { Avatar } from "../ui";
import { CountUp } from "../CountUp";
import { RULE_LABEL } from "@/lib/i18n";
import { fmtTime, relTime, ymd } from "@/lib/format";
import type { DashboardData } from "@/server/services/dashboard";

const DAY_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

// ---------------------------------------------------------------- Greeting + quick actions

export function DashGreeting({ firstName, need, done }: { firstName: string; need: number; done: number }) {
  const h = new Date().getHours();
  const hello = h < 12 ? "בוקר טוב" : h < 17 ? "צהריים טובים" : "ערב טוב";
  return (
    <div className="dash-greeting">
      <div className="dash-hello">
        {hello}, {firstName} <span aria-hidden>👋</span>
      </div>
      <h1 className="dash-question">מה בתוכנית להיום?</h1>
      <p className="dash-sub">
        {need ? `${need} אנשים מחכים למעקב` : "אין מעקבים פתוחים כרגע"}
        {done ? ` · ${done} כבר טופלו היום` : ""}
      </p>
    </div>
  );
}

export function QuickActions({ data, canEdit }: { data: DashboardData; canEdit: boolean }) {
  const items: { href: string; icon: string; title: string; text: string; badge?: number }[] = [];
  if (data.week) items.push({ href: "/sessions", icon: "qr", title: "רישום נוכחות", text: "פתיחת שיעור והצגת QR" });
  if (data.registrations) items.push({ href: "/registrations", icon: "inbox", title: "בקשות הרשמה", text: data.registrations.count ? `${data.registrations.count} חדשות לבדיקה` : "אין בקשות חדשות", badge: data.registrations.count || undefined });
  items.push({ href: "/tasks", icon: "tasks", title: "משימות", text: data.tasks.overdue ? `${data.tasks.overdue} באיחור · ${data.tasks.today} להיום` : `${data.tasks.today} להיום` });
  if (data.canReports && items.length < 3) items.push({ href: "/reports", icon: "chart", title: "דוחות", text: "האם המעקב עובד" });
  return (
    <div className="quick-actions" role="list">
      {canEdit && (
        <Link href="/contacts?new=1" className="qa-add" role="listitem" aria-label="הוספת לקוח חדש">
          <span className="qa-plus">
            <Icon name="plus" size={20} strokeWidth={2.4} />
          </span>
          <span className="qa-add-label">לקוח חדש</span>
        </Link>
      )}
      {items.slice(0, 3).map((it) => (
        <Link key={it.href} href={it.href} className="qa-tile" role="listitem">
          <span className="qa-icon">
            <Icon name={it.icon} size={24} strokeWidth={1.6} />
            {it.badge ? <span className="qa-badge num">{it.badge}</span> : null}
          </span>
          <span className="qa-title">{it.title}</span>
          <span className="qa-text">{it.text}</span>
        </Link>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Progress ring tile

export function ProgressRing({ value, size = 64, stroke = 7, tone = "accent", label }: { value: number; size?: number; stroke?: number; tone?: "accent" | "red" | "green" | "lime"; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(Math.max(0, Math.min(1, value))));
    return () => cancelAnimationFrame(id);
  }, [value]);
  return (
    <span className={`ring ring-${tone}`} style={{ width: size, height: size }} role="img" aria-label={label ?? `${Math.round(value * 100)}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="ring-fill"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ring-label num">{Math.round(value * 100)}%</span>
    </span>
  );
}

export function ProgressTile({ done, remaining }: { done: number; remaining: number }) {
  const total = done + remaining;
  const value = total ? done / total : 0;
  return (
    <div className="stat progress-tile">
      <ProgressRing value={value} tone={value >= 0.7 ? "green" : "accent"} label={`התקדמות היום ${Math.round(value * 100)}%`} />
      <div style={{ minWidth: 0 }}>
        <div className="stat-label" style={{ marginTop: 0 }}>
          התקדמות היום
        </div>
        <div className="bold" style={{ fontSize: 15 }}>
          <CountUp value={done} /> טופלו
        </div>
        <div className="xsmall subtle">{remaining ? `${remaining} נשארו` : "הכל טופל"}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Pastel category cards

type CardLike = { contactId: string; name: string; overdue: boolean; reasons: { rule: string }[] };

const CATEGORIES: { key: string; rules: string[]; label: string; icon: string; tone: string }[] = [
  { key: "renew", rules: ["R03", "R04"], label: "חידושים", icon: "card", tone: "peach" },
  { key: "leads", rules: ["R01"], label: "לידים חדשים", icon: "user_plus", tone: "sky" },
  { key: "trial", rules: ["R02"], label: "אחרי שיעור ניסיון", icon: "star", tone: "rose" },
  { key: "away", rules: ["R05", "R07"], label: "לא מגיעים לאחרונה", icon: "clock", tone: "mint" },
  { key: "tasks", rules: ["TASK"], label: "משימות שנקבעו", icon: "tasks", tone: "lilac" },
];

export function CategoryCards({ cards, active, onPick }: { cards: CardLike[]; active: string; onPick: (rules: string) => void }) {
  const cats = useMemo(
    () =>
      CATEGORIES.map((c) => {
        const people = cards.filter((x) => x.reasons.some((r) => c.rules.includes(r.rule)));
        return { ...c, people, overdue: people.filter((p) => p.overdue).length };
      }).filter((c) => c.people.length > 0),
    [cards],
  );
  if (!cats.length) return null;
  const total = Math.max(1, cards.length);
  return (
    <div className="cat-cards" role="group" aria-label="סינון לפי סוג מעקב">
      {cats.map((c) => {
        const value = c.rules.join("|");
        const pressed = active === value;
        const share = c.people.length / total;
        return (
          <button key={c.key} type="button" className={`cat-card tone-${c.tone}`} aria-pressed={pressed} onClick={() => onPick(pressed ? "" : value)}>
            <span className="cat-top">
              <span className="cat-chip">
                <Icon name={c.icon} size={14} /> {c.overdue ? `${c.overdue} באיחור` : "בזמן"}
              </span>
              {pressed && <Icon name="check" size={16} />}
            </span>
            <span className="cat-title">{c.label}</span>
            <span className="cat-meta">
              <span>{RULE_LABEL[c.rules[0]] && c.rules.length === 1 ? RULE_LABEL[c.rules[0]] : c.rules.map((r) => RULE_LABEL[r]).join(" / ")}</span>
            </span>
            <span className="cat-bar" aria-hidden>
              <span className="grow-x" style={{ width: `${Math.max(6, share * 100)}%` }} />
            </span>
            <span className="cat-bottom">
              <span className="avatar-stack" aria-hidden>
                {c.people.slice(0, 3).map((p) => (
                  <Avatar key={p.contactId} name={p.name} size="sm" />
                ))}
                {c.people.length > 3 && <span className="avatar-more">+{c.people.length - 3}</span>}
              </span>
              <span className="cat-count num">
                <CountUp value={c.people.length} /> אנשים
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Week schedule

export function WeekSchedule({ week, tz }: { week: NonNullable<DashboardData["week"]>; tz: string }) {
  const today = ymd(new Date(), tz);
  const byDay = useMemo(() => {
    const m = new Map<string, typeof week.sessions>();
    for (const s of week.sessions) {
      const d = ymd(s.start_at, tz);
      m.set(d, [...(m.get(d) ?? []), s]);
    }
    return m;
  }, [week.sessions, tz]);
  // Default to today; if today has no classes, the next day that does (else the last one this week).
  const [day, setDay] = useState(() => {
    if (byDay.has(today) || !byDay.size) return week.days.includes(today) ? today : week.days[0];
    return week.days.find((d) => d > today && byDay.has(d)) ?? [...week.days].reverse().find((d) => byDay.has(d)) ?? today;
  });
  const list = byDay.get(day) ?? [];
  const monthLabel = new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  return (
    <section className="card widget" aria-labelledby="w-week">
      <div className="widget-head">
        <h2 className="widget-title" id="w-week">
          {monthLabel}
        </h2>
        <Link href="/sessions" className="widget-link">
          לכל השיעורים
        </Link>
      </div>
      <div className="week-strip" role="tablist" aria-label="בחירת יום">
        {week.days.map((d, i) => {
          const has = byDay.has(d);
          return (
            <button key={d} type="button" role="tab" aria-selected={d === day} className={d === today ? "week-day is-today" : "week-day"} onClick={() => setDay(d)}>
              <span className="week-dow">{DAY_SHORT[i]}</span>
              <span className="week-num num">{Number(d.slice(8))}</span>
              <span className={has ? "week-dot" : "week-dot is-empty"} />
            </button>
          );
        })}
      </div>
      <div className="week-list" key={day}>
        {list.length === 0 ? (
          <p className="small subtle" style={{ padding: "10px 4px" }}>
            אין שיעורים ביום הזה.
          </p>
        ) : (
          list.map((s) => (
            <Link key={s.id} href={`/sessions/${s.id}`} className={s.status === "cancelled" ? "slot cancelled" : "slot"}>
              <span className="slot-time num">
                {fmtTime(s.start_at, tz)}
                <span className="subtle">{fmtTime(s.end_at, tz)}</span>
              </span>
              <span className="slot-body">
                <span className="bold truncate">{s.title}</span>
                <span className="xsmall subtle truncate">{s.status === "cancelled" ? "בוטל" : s.trainer_name ?? "ללא מדריך/ה"}</span>
              </span>
              <span className="slot-count num" title="נוכחים">
                <Icon name="people" size={14} /> {s.attendance_count}
              </span>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Tasks

export function TasksWidget({ tasks }: { tasks: DashboardData["tasks"] }) {
  const now = Date.now();
  return (
    <section className="card widget" aria-labelledby="w-tasks">
      <div className="widget-head">
        <h2 className="widget-title" id="w-tasks">
          משימות להיום
          {tasks.overdue > 0 && <span className="widget-pill red">{tasks.overdue} באיחור</span>}
        </h2>
        <Link href="/tasks" className="widget-link">
          לכל המשימות
        </Link>
      </div>
      {tasks.items.length === 0 ? (
        <p className="small subtle" style={{ padding: "6px 4px 2px" }}>
          אין משימות פתוחות להיום.
        </p>
      ) : (
        <div className="task-rows">
          {tasks.items.map((t) => {
            const late = Date.parse(t.due_at) < now;
            return (
              <Link key={t.id} href={`/contacts/${t.contact_id}`} className="task-row">
                <span className={late ? "task-dot late" : t.status === "in_progress" ? "task-dot going" : "task-dot"} />
                <span className="task-body">
                  <span className="bold truncate">{t.title || RULE_LABEL[t.reason_code] || "מעקב"}</span>
                  <span className="xsmall subtle truncate">
                    {t.contact_name}
                    {t.assignee_name ? ` · ${t.assignee_name}` : ""}
                  </span>
                </span>
                <span className={late ? "task-due late" : "task-due"}>{relTime(t.due_at)}</span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Registrations inbox

export function RegistrationsInbox({ regs }: { regs: NonNullable<DashboardData["registrations"]> }) {
  return (
    <section className="card widget" aria-labelledby="w-inbox">
      <div className="widget-head">
        <h2 className="widget-title" id="w-inbox">
          בקשות הרשמה
          {regs.count > 0 && <span className="widget-pill">{regs.count}</span>}
        </h2>
        <Link href="/registrations" className="widget-link">
          לכל הבקשות
        </Link>
      </div>
      {regs.latest.length === 0 ? (
        <p className="small subtle" style={{ padding: "6px 4px 2px" }}>
          אין בקשות חדשות. הן יופיעו כאן כשמישהו יסרוק את ה-QR בכניסה.
        </p>
      ) : (
        <div className="inbox-rows">
          {regs.latest.map((r, i) => (
            <Link key={r.id} href={r.contact_id ? `/contacts/${r.contact_id}` : "/registrations"} className={i === 0 ? "inbox-row featured" : "inbox-row"}>
              <Avatar name={r.name} size="sm" />
              <span className="inbox-body">
                <span className="bold truncate">{r.name}</span>
                <span className="xsmall truncate inbox-sub">{r.interest || "בקשת הרשמה חדשה"}</span>
              </span>
              <span className="xsmall inbox-time">{relTime(r.created_at)}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Highlight card

export function HighlightCard({ data }: { data: DashboardData }) {
  if (data.registrations) {
    return (
      <section className="highlight-card">
        <span className="highlight-icon">
          <Icon name="qr" size={26} />
        </span>
        <h2 className="highlight-title">פוסטר הרשמה ב-QR</h2>
        <p className="highlight-text">תלו אותו בכניסה לסטודיו — מתעניינים נרשמים מהטלפון ומופיעים כאן למעקב.</p>
        <Link href="/registrations?poster=1" className="btn dark sm">
          לפוסטר
        </Link>
      </section>
    );
  }
  if (data.canImport) {
    return (
      <section className="highlight-card">
        <span className="highlight-icon">
          <Icon name="upload" size={26} />
        </span>
        <h2 className="highlight-title">מביאים את הלקוחות</h2>
        <p className="highlight-text">ייבוא מקובץ CSV (גם מייצוא של Monday), עם תצוגה מקדימה לפני שמירה.</p>
        <Link href="/imports" className="btn dark sm">
          לייבוא
        </Link>
      </section>
    );
  }
  return null;
}
