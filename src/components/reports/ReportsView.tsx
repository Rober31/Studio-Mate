"use client";
import "@/app/admin.css";

import { useState } from "react";
import { api } from "@/lib/api";
import { fmtYmd } from "@/lib/format";
import { OUTCOME_LABEL, STAGE_LABEL, STAGE_ORDER } from "@/lib/i18n";
import { Icon } from "../Icon";
import { CountUp } from "../CountUp";
import { Banner, EmptyState, Segmented, useToast } from "../ui";

type Summary = {
  period: { from: string; to: string; days: number };
  followupsDue: number;
  tasks: { due: number; completed: number; dismissed: number; snoozed: number; completionRate: number | null };
  funnel: { drafts: number; waOpened: number; markedSent: number; outcomes: number; confirmed: number };
  outcomeBreakdown: { outcome: string; n: number }[];
  trialConversion: { trials: number; converted: number; rate: number | null };
  renewals: { total: number; linked: number };
  dataCoverage: { totalContacts: number; validPhones: number; needsReview: number; rate: number | null };
  ai: { drafts: number; fallbacks: number; units: number; quota: number };
  daily: { day: string; sent: number; outcomes: number }[];
  stageCounts: { stage: string; n: number }[];
};

function Kpi({
  value,
  label,
  note,
  tone,
  icon,
  hero,
  percent,
}: {
  value: number | null;
  label: string;
  note?: string;
  tone?: "red" | "orange";
  icon: string;
  hero?: boolean;
  percent?: boolean;
}) {
  return (
    <div className={hero ? "stat hero" : "stat"}>
      <div className="stat-top">
        <span className="icon-chip">
          <Icon name={icon} size={18} />
        </span>
      </div>
      <div className="stat-value" style={{ color: tone && !hero ? `var(--${tone})` : undefined }}>
        {value === null ? "—" : <CountUp value={percent ? Math.round(value * 100) : value} format={percent ? (n) => `${Math.round(n)}%` : undefined} />}
      </div>
      <div className="stat-label">{label}</div>
      {note && <div className="kpi-note">{note}</div>}
    </div>
  );
}

function HBars({ rows, max }: { rows: { label: string; value: number; muted?: boolean }[]; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div role="list">
      {rows.map((r) => (
        <div key={r.label} className="hbar" role="listitem" title={`${r.label}: ${r.value}`}>
          <span className="truncate">{r.label}</span>
          <span className="hbar-track" aria-hidden>
            <span className={r.muted ? "hbar-fill muted" : "hbar-fill"} style={{ width: `${(r.value / top) * 100}%`, display: "block" }} />
          </span>
          <span className="num bold">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Fill missing days so the column chart reads as a continuous timeline. */
function fillDays(daily: Summary["daily"], from: string, days: number) {
  const map = new Map(daily.map((d) => [d.day, d]));
  const out: Summary["daily"] = [];
  const start = new Date(from);
  for (let i = 1; i <= days; i++) {
    const d = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    out.push(map.get(d) ?? { day: d, sent: 0, outcomes: 0 });
  }
  return out;
}

export function ReportsView({ initial, hasAi }: { initial: Summary; tz: string; hasAi: boolean }) {
  const toast = useToast();
  const [data, setData] = useState(initial);
  const [days, setDays] = useState(String(initial.period.days));
  const [loading, setLoading] = useState(false);

  const load = async (d: string) => {
    setDays(d);
    setLoading(true);
    try {
      setData(await api<Summary>(`/api/reports?days=${d}`));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  const f = data.funnel;
  const daily = fillDays(data.daily, data.period.from, data.period.days);
  const dailyMax = Math.max(1, ...daily.map((d) => d.sent + d.outcomes));
  const stages = STAGE_ORDER.map((s) => ({ label: STAGE_LABEL[s], value: data.stageCounts.find((x) => x.stage === s)?.n ?? 0, muted: s === "lost" }));
  const quotaUse = data.ai.quota ? data.ai.drafts / data.ai.quota : 0;
  const empty = f.drafts === 0 && f.outcomes === 0 && data.tasks.due === 0;

  return (
    <div className="page" aria-busy={loading}>
      <div className="page-head">
        <div>
          <h1 className="page-title">דוחות</h1>
          <p className="page-sub">האם המעקב עובד — לפי מה שבאמת קרה, לא לפי מספר ההודעות.</p>
        </div>
        <Segmented
          label="תקופה"
          value={days}
          onChange={load}
          options={[
            { value: "7", label: "7 ימים" },
            { value: "30", label: "30 ימים" },
            { value: "90", label: "90 ימים" },
          ]}
        />
      </div>

      <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity 200ms" }} className="stack-6">
        {empty && <Banner tone="info">עוד אין פעילות מעקב בתקופה הזו. הנתונים יתמלאו ככל שהצוות יכין הודעות ויתעד תוצאות.</Banner>}

        <div className="kpi-grid kpis">
          <Kpi hero icon="today" value={data.followupsDue} label="מעקבים לביצוע עכשיו" note="לקוחות ייחודיים, אחרי החרגות" />
          <Kpi
            icon="checkCircle"
            percent
            value={data.tasks.completionRate}
            label="שיעור השלמת משימות"
            note={`${data.tasks.completed} מתוך ${data.tasks.due} שהגיע מועדן${data.tasks.dismissed ? ` · ${data.tasks.dismissed} הוחרגו` : ""}`}
          />
          <Kpi icon="message" value={f.markedSent} label="הודעות שסומנו כנשלחו" note={`${f.confirmed} מעקבים מאושרים (כולל שיחות)`} />
          <Kpi icon="star" percent value={data.trialConversion.rate} label="המרה אחרי ניסיון" note={`${data.trialConversion.converted} מתוך ${data.trialConversion.trials} · תוך 30 יום`} />
          <Kpi icon="refresh" value={data.renewals.linked} label="חידושים אחרי מעקב" note={`מתוך ${data.renewals.total} חידושים · תוך 14 יום`} />
          <Kpi
            icon="phone"
            percent
            value={data.dataCoverage.rate}
            label="תיקים עם טלפון תקין"
            note={`${data.dataCoverage.needsReview} לבדיקה`}
            tone={data.dataCoverage.rate !== null && data.dataCoverage.rate < 0.9 ? "orange" : undefined}
          />
        </div>

        <div className="report-grid">
          <section className="card card-pad" aria-labelledby="funnel-t">
            <h2 className="card-title" id="funnel-t">
              מהטיוטה ועד התוצאה
            </h2>
            <p className="small muted" style={{ marginBottom: 8 }}>
              כל שלב נספר בנפרד.
            </p>
            {[
              { label: "טיוטות שהוכנו", v: f.drafts },
              { label: "נפתחו בוואטסאפ", v: f.waOpened, note: "פתיחה אינה הוכחה שההודעה נשלחה" },
              { label: "סומנו כנשלחו", v: f.markedSent, note: "אישור ידני של העובד" },
              { label: "תועדה תוצאה", v: f.outcomes },
            ].map((s) => {
              const top = Math.max(1, f.drafts, f.waOpened, f.markedSent, f.outcomes);
              return (
                <div key={s.label} className="funnel-step" title={`${s.label}: ${s.v}`}>
                  <span className="small">
                    {s.label}
                    {s.note && <span className="xsmall subtle"> · {s.note}</span>}
                  </span>
                  <span className="num bold">{s.v}</span>
                  <span className="hbar-track" aria-hidden>
                    <span className="hbar-fill" style={{ width: `${(s.v / top) * 100}%`, display: "block" }} />
                  </span>
                </div>
              );
            })}
          </section>

          <section className="card card-pad" aria-labelledby="out-t">
            <h2 className="card-title" id="out-t" style={{ marginBottom: 8 }}>
              תוצאות המעקב
            </h2>
            {data.outcomeBreakdown.length ? (
              <HBars rows={data.outcomeBreakdown.map((o) => ({ label: OUTCOME_LABEL[o.outcome] ?? o.outcome, value: o.n }))} />
            ) : (
              <EmptyState icon="chart" title="עוד לא תועדו תוצאות" text="תוצאות יופיעו כאן אחרי שהצוות יתעד מה קרה בכל מעקב." />
            )}
          </section>

          <section className="card card-pad" aria-labelledby="daily-t">
            <div className="row between" style={{ marginBottom: 6 }}>
              <h2 className="card-title" id="daily-t">
                פעילות יומית
              </h2>
              <span className="xsmall subtle">הודעות שנשלחו ותוצאות שתועדו</span>
            </div>
            <div className="cols-chart" role="img" aria-label={`פעילות יומית ב-${data.period.days} הימים האחרונים`}>
              {daily.map((d) => {
                const v = d.sent + d.outcomes;
                return (
                  <span key={d.day} className="col-bar" tabIndex={0} aria-label={`${fmtYmd(d.day)}: ${d.sent} נשלחו, ${d.outcomes} תוצאות`}>
                    <span style={{ height: `${v ? Math.max(4, (v / dailyMax) * 100) : 0}%` }} />
                    <span className="col-tip">
                      {fmtYmd(d.day)} · {d.sent} נשלחו · {d.outcomes} תוצאות
                    </span>
                  </span>
                );
              })}
            </div>
            <div className="row between xsmall subtle" style={{ marginTop: 6 }}>
              <span>{fmtYmd(daily[0]?.day)}</span>
              <span>{fmtYmd(daily[daily.length - 1]?.day)}</span>
            </div>
          </section>

          <section className="card card-pad" aria-labelledby="stage-t">
            <h2 className="card-title" id="stage-t" style={{ marginBottom: 8 }}>
              לקוחות לפי שלב
            </h2>
            <HBars rows={stages} />
          </section>
        </div>

        {hasAi && (
          <section className="card card-pad" aria-labelledby="ai-t">
            <div className="row between wrap" style={{ gap: 8 }}>
              <h2 className="card-title" id="ai-t">
                שימוש בעוזר הניסוח
              </h2>
              <span className="small muted num">
                {data.ai.drafts} / {data.ai.quota} הצעות החודש
              </span>
            </div>
            <div className={quotaUse > 0.85 ? "meter warn" : "meter"} style={{ margin: "12px 0 8px" }} role="progressbar" aria-valuenow={data.ai.drafts} aria-valuemin={0} aria-valuemax={data.ai.quota}>
              <span style={{ width: `${Math.min(100, quotaUse * 100)}%` }} />
            </div>
            <p className="small muted">
              {data.ai.fallbacks} פעמים הוכנה הודעה מתבנית קבועה בתקופה (כשהעוזר לא זמין או שההצעה לא עברה בדיקה). כשהמכסה נגמרת — ממשיכים עם תבניות, ושאר המערכת עובדת כרגיל.
            </p>
          </section>
        )}

        <div className="small muted stack-1" style={{ paddingInline: 4 }}>
          <p className="row" style={{ gap: 6 }}>
            <Icon name="info" size={15} /> איך לקרוא את הדוח:
          </p>
          <p>· &quot;נפתחו בוואטסאפ&quot; לא מוכיח שליחה, קריאה או מסירה. רק &quot;סומנו כנשלחו&quot; נספר כמעקב שבוצע.</p>
          <p>· &quot;חידושים אחרי מעקב&quot; — חידוש מתועד שהתרחש עד 14 יום אחרי מעקב. זה קשר בזמן, לא הוכחה שהמעקב גרם לחידוש.</p>
          <p>· &quot;המרה אחרי ניסיון&quot; — מי שהיה/תה בשיעור ניסיון בתקופה והתחיל/ה מנוי מתועד תוך 30 יום.</p>
        </div>
      </div>
    </div>
  );
}
