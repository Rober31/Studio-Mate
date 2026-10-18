"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SESSION_STATUS_LABEL } from "@/lib/i18n";
import { fmtTime, ymd } from "@/lib/format";
import { Icon } from "../Icon";
import { Badge, Button, EmptyState, IconButton, cx } from "../ui";
import { SessionFormSheet, type SessionItem } from "./SessionForm";
import "@/app/sessions.css";

const STATUS_TONE: Record<string, "green" | "blue" | "gray" | "red"> = { scheduled: "blue", open: "green", completed: "gray", cancelled: "red" };

function addDays(ymdStr: string, n: number) {
  const [y, m, d] = ymdStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function dayLabel(ymdStr: string) {
  const [y, m, d] = ymdStr.split("-").map(Number);
  return new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

function rangeLabel(start: string) {
  const end = addDays(start, 6);
  const f = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  };
  return `${f(start)} – ${f(end)}`;
}

export function SessionsView({
  sessions,
  weekStart,
  today,
  tz,
  staff,
  canManage,
  canExport,
  range,
}: {
  sessions: SessionItem[];
  weekStart: string;
  today: string;
  tz: string;
  staff: { id: string; name: string; role?: string }[];
  canManage: boolean;
  canExport: boolean;
  range: { from: string; to: string };
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const isThisWeek = today >= weekStart && today <= addDays(weekStart, 6);
  const [selectedDay, setSelectedDay] = useState<string>(isThisWeek ? today : weekStart);

  const byDay = useMemo(() => {
    const m = new Map<string, SessionItem[]>();
    for (let i = 0; i < 7; i++) m.set(addDays(weekStart, i), []);
    for (const s of sessions) {
      const d = ymd(s.start_at, tz);
      m.get(d)?.push(s);
    }
    return m;
  }, [sessions, weekStart, tz]);

  const go = (offsetWeeks: number | "today") => {
    const target = offsetWeeks === "today" ? today : addDays(weekStart, offsetWeeks * 7);
    router.push(`/sessions?week=${target}`);
  };

  const days = Array.from(byDay.keys());
  const now = new Date().toISOString();

  const renderSession = (s: SessionItem) => {
    const live = s.status !== "cancelled" && s.start_at <= new Date(Date.now() + 30 * 60_000).toISOString() && s.end_at >= now;
    return (
      <Link key={s.id} href={`/sessions/${s.id}`} className={cx("list-item", s.status === "cancelled" && "is-cancelled")}>
        <div className="session-time num">
          <span className="bold">{fmtTime(s.start_at, tz)}</span>
          <span className="xsmall subtle">{fmtTime(s.end_at, tz)}</span>
        </div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="bold truncate" style={{ textDecoration: s.status === "cancelled" ? "line-through" : undefined }}>
            {s.title}
          </div>
          <div className="xsmall subtle truncate">{s.trainer_name ?? "ללא מדריך/ה"}</div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {live && s.status !== "completed" ? (
            <Badge tone="green" dot>
              עכשיו
            </Badge>
          ) : (
            <Badge tone={STATUS_TONE[s.status]}>{SESSION_STATUS_LABEL[s.status]}</Badge>
          )}
          <span className="badge" title="נוכחים">
            <Icon name="people" size={13} />
            <span className="num">{s.attendance_count}</span>
          </span>
        </div>
        <Icon name="chevron" size={18} className="list-chevron" />
      </Link>
    );
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">שיעורים ונוכחות</h1>
          <p className="page-sub">{rangeLabel(weekStart)}</p>
        </div>
        <div className="row">
          {canExport && (
            <a className="btn hide-mobile" href={`/api/sessions/export?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`}>
              <Icon name="download" size={18} /> ייצוא השבוע
            </a>
          )}
          {canManage && (
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              <span className="hide-mobile">שיעור חדש</span>
              <span className="hide-desktop">חדש</span>
            </Button>
          )}
        </div>
      </div>

      <div className="row between" style={{ marginBottom: 14 }}>
        <div className="row" style={{ gap: 4 }}>
          <IconButton icon="back" label="השבוע הקודם" onClick={() => go(-1)} />
          <IconButton icon="chevron" label="השבוע הבא" onClick={() => go(1)} />
          {!isThisWeek && (
            <Button size="sm" variant="ghost" onClick={() => go("today")}>
              השבוע
            </Button>
          )}
        </div>
        <span className="xsmall subtle">{sessions.filter((s) => s.status !== "cancelled").length} שיעורים השבוע</span>
      </div>

      {/* Mobile: day strip + one day at a time */}
      <div className="hide-desktop">
        <div className="day-strip" role="tablist" aria-label="ימי השבוע">
          {days.map((d) => {
            const [, , dd] = d.split("-");
            const wd = new Intl.DateTimeFormat("he-IL", { weekday: "narrow", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
            const count = byDay.get(d)?.filter((s) => s.status !== "cancelled").length ?? 0;
            return (
              <button key={d} role="tab" aria-selected={selectedDay === d} className={cx("day-pill", d === today && "is-today")} onClick={() => setSelectedDay(d)}>
                <span className="xsmall">{wd}</span>
                <span className="bold num" style={{ fontSize: 17 }}>
                  {Number(dd)}
                </span>
                <span className="day-dot" style={{ opacity: count ? 1 : 0 }} />
              </button>
            );
          })}
        </div>
        <div className="section-label" style={{ marginTop: 16 }}>
          {dayLabel(selectedDay)}
          {selectedDay === today ? " · היום" : ""}
        </div>
        {byDay.get(selectedDay)?.length ? (
          <div className="list">{byDay.get(selectedDay)!.map(renderSession)}</div>
        ) : (
          <div className="card">
            <EmptyState icon="calendar" title="אין שיעורים ביום הזה" action={canManage ? <Button onClick={() => setCreating(true)}>הוספת שיעור</Button> : undefined} />
          </div>
        )}
      </div>

      {/* Desktop: the whole week */}
      <div className="hide-mobile stack-4">
        {sessions.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="calendar"
              title="אין שיעורים בשבוע הזה"
              text="שיעורים הם הבסיס לרישום נוכחות ב-QR. אפשר להוסיף שיעור חד-פעמי או שיעור שחוזר כל שבוע."
              action={canManage ? <Button variant="primary" onClick={() => setCreating(true)}>הוספת שיעור</Button> : undefined}
            />
          </div>
        ) : (
          days
            .filter((d) => byDay.get(d)!.length > 0)
            .map((d) => (
              <section key={d}>
                <div className="section-label">
                  {dayLabel(d)}
                  {d === today ? " · היום" : ""}
                </div>
                <div className="list">{byDay.get(d)!.map(renderSession)}</div>
              </section>
            ))
        )}
      </div>

      <p className="xsmall subtle" style={{ marginTop: 20 }}>
        המערכת מכירה את מי שנרשם/ה כנוכח/ת. בלי רשימת הזמנות מאפליקציה חיצונית לא מסמנים &quot;נעדר/ת&quot; ולא מחשבים תפוסה.
      </p>

      <SessionFormSheet open={creating} onClose={() => setCreating(false)} defaultDate={selectedDay < today ? today : selectedDay} tz={tz} staff={staff} />
    </div>
  );
}
