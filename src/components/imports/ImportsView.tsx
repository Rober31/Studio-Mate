"use client";
import "@/app/admin.css";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { relTime, fmtDateTime } from "@/lib/format";
import { Icon } from "../Icon";
import { Badge, Banner, Button, EmptyState, Sheet, SelectField, Skeleton, SuccessCheck, useConfirm, useToast, cx } from "../ui";

const FIELD_LABEL: Record<string, string> = {
  display_name: "שם מלא",
  first_name: "שם פרטי",
  last_name: "שם משפחה",
  phone: "טלפון",
  stage: "שלב",
  owner: "אחראי (אימייל או שם)",
  source: "מקור",
  interest: "תחום עניין",
  tags: "תגיות",
  note: "הערה",
  language: "שפה (he/ar/en)",
  external_id: "מזהה במערכת המקור",
  plan_name: "שם מסלול",
  membership_start: "תחילת מנוי",
  membership_end: "סיום מנוי",
  balance: "יתרת שיעורים",
};

const TEMPLATE_HEADERS = ["שם מלא", "טלפון", "שלב", "אחראי", "מקור", "תחום עניין", "תגיות", "הערות", "מסלול", "תחילת מנוי", "סיום מנוי", "יתרה"];
const TEMPLATE_ROW = ["דוגמה ישראלי", "050-0000000", "ליד חדש", "", "אינסטגרם", "פילאטיס מכשירים", "בוקר", "", "", "", "", ""];

const ROW_STATUS: Record<string, { label: string; tone: "green" | "blue" | "orange" | "red" | "gray" }> = {
  create: { label: "ייווצר", tone: "green" },
  update: { label: "יעודכן", tone: "blue" },
  needs_review: { label: "לבדיקה", tone: "orange" },
  error: { label: "שגיאה", tone: "red" },
  created: { label: "נוצר", tone: "green" },
  updated: { label: "עודכן", tone: "blue" },
  skipped: { label: "דולג", tone: "gray" },
};

const PROVIDER_INFO: Record<string, { icon: string; text: string }> = {
  csv: { icon: "upload", text: "ייבוא קובץ CSV מכל מערכת. נתוני מנויים מיובאים נחשבים עדכניים לפי תקופת התוקף שהוגדרה." },
  booking_app: {
    icon: "plug",
    text: "החיבור לאפליקציית ההזמנות ייבנה רק אחרי שנוודא שיש לה ממשק (API) והרשאת גישה. עד אז אפשר לייצא ממנה קובץ ולייבא אותו כאן.",
  },
  monday: {
    icon: "layers",
    text: "אין חיבור ישיר. כדי להעביר נתונים: ייצוא הלוח מ-Monday לקובץ Excel/CSV, שמירה כ-CSV UTF-8, וייבוא כאן.",
  },
};

type Preview = {
  needsMapping: boolean;
  batchId?: string;
  previewHash?: string;
  headers: string[];
  mapping: Record<string, string>;
  counts?: { total: number; create: number; update: number; needs_review: number; error: number };
  rows?: { row: number; status: string; message: string | null; data: Record<string, string> }[];
  sample?: string[][];
};

type Report = {
  batch: { id: string; file_name: string; status: string; total_rows: number; created_at: string; committed_at: string | null };
  counts: Record<string, number>;
  rows: { row: number; status: string; message: string | null; contactId: string | null; name: string }[];
};

type History = { id: string; file_name: string; status: string; total_rows: number; ok_rows: number; error_rows: number; created_at: string; committed_at: string | null; created_by_name: string | null }[];

function sampleRows(text: string, n = 5): string[][] {
  // Light client-side parse for the mapping preview only; the server parses authoritatively.
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  const first = s.split(/\r?\n/, 1)[0] ?? "";
  const delim = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  for (let i = 0; i < s.length && out.length <= n; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) out.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (out.length <= n && (cell || row.length)) {
    row.push(cell);
    if (row.some((c) => c.trim())) out.push(row);
  }
  return out.slice(1, n + 1);
}

function downloadTemplate() {
  const csv = "﻿" + [TEMPLATE_HEADERS.join(","), TEMPLATE_ROW.join(",")].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "studiomate-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

const STEPS = [
  { key: "upload", label: "קובץ" },
  { key: "mapping", label: "התאמת עמודות" },
  { key: "preview", label: "בדיקה" },
  { key: "done", label: "סיום" },
] as const;
type Step = (typeof STEPS)[number]["key"];

export function ImportsView({
  history,
  connections,
  fields,
  canExport,
  freshnessHours,
  tz,
}: {
  history: History;
  connections: { provider: string; name: string; status: string; last_success_at: string | null; freshness_hours: number; last_error: string | null }[];
  fields: string[];
  canExport: boolean;
  freshnessHours: number;
  tz: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sample, setSample] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dateFormat, setDateFormat] = useState("DD/MM/YYYY");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [viewReport, setViewReport] = useState<Report | null>(null);

  const reset = () => {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setReport(null);
    setError(null);
    setFilter("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const onFile = async (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name)) return setError("אפשר לייבא רק קובץ CSV. ב-Excel: קובץ ← שמירה בשם ← CSV UTF-8.");
    if (f.size > 10 * 1024 * 1024) return setError("הקובץ גדול מ-10MB. פצלו אותו לכמה קבצים.");
    const content = await f.text();
    setBusy(true);
    try {
      const p = await api<Preview>("/api/imports/preview", { body: { file_name: f.name, content, date_format: dateFormat } });
      setFile({ name: f.name, content });
      setHeaders(p.headers);
      setMapping(p.mapping);
      setSample(p.sample ?? sampleRows(content));
      setStep("mapping");
    } catch (e) {
      const err = e as ApiError;
      setError(err.fields?.content ?? err.message);
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api<Preview>("/api/imports/preview", { body: { file_name: file.name, content: file.content, mapping, date_format: dateFormat } });
      if (p.needsMapping) {
        setError("צריך לבחור לפחות עמודה אחת של שם (שם מלא או שם פרטי).");
        return;
      }
      setPreview(p);
      setFilter("");
      setStep("preview");
    } catch (e) {
      const err = e as ApiError;
      setError(err.fields?.content ?? err.message);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview?.batchId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<Report>(`/api/imports/${preview.batchId}/commit`, { body: { preview_hash: preview.previewHash } });
      setReport(r);
      setStep("done");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (batchId: string, after?: () => void) => {
    const okd = await confirm({
      title: "לבטל את הייבוא?",
      body: "התיקים שנוצרו בייבוא הזה יועברו לארכיון. אפשר לבטל רק אם עוד לא בוצעו בהם שינויים. תיקים קיימים שעודכנו לא יוחזרו למצבם הקודם.",
      confirm: "ביטול הייבוא",
      danger: true,
    });
    if (!okd) return;
    try {
      const r = await api<{ archived: number }>(`/api/imports/${batchId}/rollback`, { method: "POST" });
      toast(`הייבוא בוטל · ${r.archived} תיקים הועברו לארכיון`, "success");
      router.refresh();
      after?.();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const openReport = async (id: string) => {
    try {
      setViewReport(await api<Report>(`/api/imports/${id}`));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const mappedFields = Object.values(mapping).filter(Boolean);
  const dupField = mappedFields.find((f, i) => mappedFields.indexOf(f) !== i);
  const hasName = mappedFields.includes("display_name") || mappedFields.includes("first_name");
  const hasDates = mappedFields.includes("membership_start") || mappedFields.includes("membership_end");
  const stepIdx = STEPS.findIndex((s) => s.key === step);
  const rows = useMemo(() => (preview?.rows ?? []).filter((r) => !filter || r.status === filter), [preview, filter]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">ייבוא וחיבורים</h1>
          <p className="page-sub">הכנסת לקוחות ומנויים מקובץ, ומצב החיבורים למערכות אחרות.</p>
        </div>
        {canExport && (
          <a href="/api/export/contacts" className="btn" download>
            <Icon name="download" size={18} /> <span>ייצוא לקוחות</span>
          </a>
        )}
      </div>

      <section className="card" style={{ marginBottom: 24 }} aria-labelledby="import-title">
        <div className="card-head">
          <h2 className="card-title" id="import-title">
            ייבוא מקובץ
          </h2>
          {step !== "upload" && step !== "done" && (
            <Button size="sm" variant="ghost" onClick={reset}>
              התחלה מחדש
            </Button>
          )}
        </div>
        <div className="card-pad stack-4">
          <ol className="imp-steps" aria-label="שלבי הייבוא">
            {STEPS.map((s, i) => (
              <li key={s.key} className={cx(i < stepIdx && "done", i === stepIdx && "current")} aria-current={i === stepIdx ? "step" : undefined}>
                <span className="imp-step-dot">{i < stepIdx ? <Icon name="check" size={14} strokeWidth={2.6} /> : i + 1}</span>
                <span className="imp-step-label">{s.label}</span>
              </li>
            ))}
          </ol>

          {error && <Banner tone="danger">{error}</Banner>}

          {step === "upload" && (
            <div className="stack-3 fade-in">
              <label
                className={cx("imp-drop", dragOver && "over")}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  onFile(e.dataTransfer.files[0]);
                }}
              >
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} disabled={busy} />
                <span className="empty-icon" style={{ marginBottom: 4 }}>
                  {busy ? <span className="spinner" /> : <Icon name="upload" size={26} />}
                </span>
                <span className="bold" style={{ fontSize: 17 }}>
                  {busy ? "קוראים את הקובץ…" : "בחירת קובץ CSV"}
                </span>
                <span className="small muted">או גררו אותו לכאן · עד 10MB או 10,000 שורות</span>
              </label>
              <div className="row wrap small muted" style={{ gap: 12, justifyContent: "space-between" }}>
                <span className="row" style={{ gap: 6 }}>
                  <Icon name="info" size={16} /> שמרו את הקובץ כ-CSV UTF-8 כדי שהעברית תיקרא נכון. טלפונים נשמרים כטקסט.
                </span>
                <Button size="sm" variant="ghost" icon="download" onClick={downloadTemplate}>
                  קובץ לדוגמה
                </Button>
              </div>
            </div>
          )}

          {step === "mapping" && (
            <div className="stack-4 fade-in">
              <p className="muted small">
                <span className="bold" style={{ color: "var(--text)" }}>
                  {file?.name}
                </span>{" "}
                · התאימו כל עמודה בקובץ לשדה ב-StudioMate. עמודה שלא צריך — השאירו &quot;לא לייבא&quot;.
              </p>
              <div className="imp-map">
                {headers.map((h, idx) => (
                  <div key={h + idx} className="imp-map-row">
                    <div style={{ minWidth: 0 }}>
                      <div className="bold truncate">{h || `עמודה ${idx + 1}`}</div>
                      <div className="xsmall subtle truncate">{sample.map((r) => r[idx]).filter(Boolean).slice(0, 3).join(" · ") || "—"}</div>
                    </div>
                    <Icon name="chevron" size={18} className="list-chevron hide-mobile" />
                    <select
                      className="select"
                      value={mapping[h] ?? ""}
                      onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))}
                      aria-label={`שדה עבור ${h}`}
                    >
                      <option value="">לא לייבא</option>
                      {fields.map((f) => (
                        <option key={f} value={f}>
                          {FIELD_LABEL[f] ?? f}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {hasDates && (
                <SelectField
                  label="איך כתובים התאריכים בקובץ?"
                  value={dateFormat}
                  onChange={(e) => setDateFormat(e.target.value)}
                  options={[
                    { value: "DD/MM/YYYY", label: "יום/חודש/שנה (31/12/2026)" },
                    { value: "YYYY-MM-DD", label: "שנה-חודש-יום (2026-12-31)" },
                    { value: "MM/DD/YYYY", label: "חודש/יום/שנה (12/31/2026)" },
                  ]}
                />
              )}
              {dupField && <Banner tone="warn">השדה &quot;{FIELD_LABEL[dupField]}&quot; נבחר ליותר מעמודה אחת. רק אחת מהן תיובא.</Banner>}
              {!hasName && <Banner tone="warn">חובה לבחור עמודה של שם (שם מלא או שם פרטי).</Banner>}
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <Button variant="primary" loading={busy} disabled={!hasName} onClick={runPreview}>
                  המשך לבדיקה
                </Button>
              </div>
            </div>
          )}

          {step === "preview" && preview?.counts && (
            <div className="stack-4 fade-in">
              <div className="grid-4">
                {[
                  { k: "create", label: "ייווצרו", v: preview.counts.create },
                  { k: "update", label: "יעודכנו", v: preview.counts.update },
                  { k: "needs_review", label: "לבדיקה", v: preview.counts.needs_review },
                  { k: "error", label: "שגיאות", v: preview.counts.error },
                ].map((s) => (
                  <button key={s.k} className="stat" aria-pressed={filter === s.k} onClick={() => setFilter(filter === s.k ? "" : s.k)}>
                    <div className="stat-value" style={{ color: s.k === "error" && s.v ? "var(--red)" : s.k === "needs_review" && s.v ? "var(--orange)" : undefined }}>
                      {s.v}
                    </div>
                    <div className="stat-label">{s.label}</div>
                  </button>
                ))}
              </div>
              <div className="small muted stack-1">
                <p>· &quot;יעודכנו&quot; — נמצא תיק קיים לפי מזהה מקור או טלפון. רק שדות ריקים בתיק ימולאו; נתונים שכבר אומתו לא יידרסו.</p>
                <p>· &quot;לבדיקה&quot; — ייובאו לרשימת בדיקה (למשל טלפון חסר או כפול). אי אפשר לשלוח להם וואטסאפ עד לתיקון.</p>
                <p>· שורות עם שגיאה לא ייובאו, ויופיעו בדוח כדי שתוכלו לתקן ולייבא שוב.</p>
              </div>
              <div className="table-wrap list" style={{ maxHeight: 420, overflowY: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>שורה</th>
                      <th>שם</th>
                      <th className="hide-mobile">טלפון</th>
                      <th>מצב</th>
                      <th>הערה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.row}>
                        <td className="num subtle">{r.row}</td>
                        <td className="bold">{r.data.display_name || [r.data.first_name, r.data.last_name].filter(Boolean).join(" ") || "—"}</td>
                        <td className="hide-mobile ltr num" style={{ textAlign: "end" }}>
                          {r.data.phone || "—"}
                        </td>
                        <td>
                          <Badge tone={ROW_STATUS[r.status]?.tone}>{ROW_STATUS[r.status]?.label ?? r.status}</Badge>
                        </td>
                        <td className="small muted">{r.message ?? ""}</td>
                      </tr>
                    ))}
                    {!rows.length && (
                      <tr>
                        <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>
                          אין שורות בסינון הזה
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {(preview.rows?.length ?? 0) < preview.counts.total && <p className="xsmall subtle">מוצגות {preview.rows?.length} השורות הראשונות מתוך {preview.counts.total}. הדוח המלא יופיע אחרי הייבוא.</p>}
              <div className="row wrap" style={{ justifyContent: "space-between", gap: 8 }}>
                <Button variant="ghost" onClick={() => setStep("mapping")}>
                  חזרה להתאמת עמודות
                </Button>
                <Button variant="primary" loading={busy} disabled={preview.counts.total === preview.counts.error} onClick={commit}>
                  ייבוא {preview.counts.create + preview.counts.update + preview.counts.needs_review} שורות
                </Button>
              </div>
            </div>
          )}

          {step === "done" && report && (
            <div className="stack-4 fade-in">
              <div className="col" style={{ alignItems: "center", textAlign: "center", gap: 10, padding: "8px 0 4px" }}>
                <SuccessCheck size={64} />
                <div className="bold" style={{ fontSize: 18 }}>
                  הייבוא הושלם
                </div>
                <div className="row wrap" style={{ justifyContent: "center", gap: 6 }}>
                  {Object.entries(report.counts).map(([k, v]) => (
                    <Badge key={k} tone={ROW_STATUS[k]?.tone}>
                      {ROW_STATUS[k]?.label ?? k}: {v}
                    </Badge>
                  ))}
                </div>
              </div>
              <ReportRows report={report} />
              <div className="row wrap" style={{ justifyContent: "space-between", gap: 8 }}>
                <Button variant="ghost" icon="refresh" onClick={() => rollback(report.batch.id, reset)}>
                  ביטול הייבוא
                </Button>
                <div className="row wrap">
                  {(report.counts.needs_review ?? 0) > 0 && (
                    <Link href="/contacts?review=1" className="btn">
                      לרשימת הבדיקה
                    </Link>
                  )}
                  <Button variant="primary" onClick={reset}>
                    ייבוא נוסף
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="imp-two">
        <section aria-labelledby="int-title">
          <h2 className="section-title" id="int-title">
            חיבורים
          </h2>
          <div className="stack-3">
            {connections.map((c) => {
              const info = PROVIDER_INFO[c.provider] ?? { icon: "plug", text: "" };
              const active = c.status === "active";
              const fresh = c.last_success_at ? Date.now() - Date.parse(c.last_success_at) < freshnessHours * 3_600_000 : false;
              return (
                <div key={c.provider} className="card card-pad" style={{ padding: 16 }}>
                  <div className="row start" style={{ gap: 12 }}>
                    <span className="tl-icon" style={{ width: 38, height: 38, borderRadius: 11 }}>
                      <Icon name={info.icon} size={19} />
                    </span>
                    <div className="grow stack-1" style={{ minWidth: 0 }}>
                      <div className="row between wrap" style={{ gap: 6 }}>
                        <span className="bold">{c.name}</span>
                        {active ? (
                          <Badge tone={fresh ? "green" : "orange"} dot>
                            {fresh ? "עדכני" : "לא עודכן לאחרונה"}
                          </Badge>
                        ) : (
                          <Badge tone="gray" dot>
                            לא מחובר
                          </Badge>
                        )}
                      </div>
                      {c.provider === "csv" && c.last_success_at && (
                        <div className="xsmall subtle">
                          ייבוא אחרון {relTime(c.last_success_at)} · נתונים נחשבים עדכניים עד {freshnessHours} שעות
                        </div>
                      )}
                      <p className="small muted">{info.text}</p>
                      {c.last_error && <Banner tone="danger">{c.last_error}</Banner>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="hist-title">
          <h2 className="section-title" id="hist-title">
            ייבואים קודמים
          </h2>
          {history.length === 0 ? (
            <div className="card">
              <EmptyState icon="history" title="עוד לא בוצע ייבוא" text="אחרי ייבוא ראשון, הדוח שלו יישמר כאן." />
            </div>
          ) : (
            <div className="list">
              {history.map((h) => (
                <button key={h.id} className="list-item" onClick={() => openReport(h.id)}>
                  <Icon name="note" size={19} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="bold truncate" style={{ display: "block" }}>
                      {h.file_name}
                    </span>
                    <span className="xsmall subtle">
                      {fmtDateTime(h.committed_at ?? h.created_at, tz)} · {h.total_rows} שורות{h.error_rows ? ` · ${h.error_rows} שגיאות` : ""}
                      {h.created_by_name ? ` · ${h.created_by_name}` : ""}
                    </span>
                  </span>
                  {h.status === "rolled_back" ? <Badge tone="gray">בוטל</Badge> : <Badge tone="green">יובא</Badge>}
                  <Icon name="chevron" size={18} className="list-chevron" />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <Sheet
        open={!!viewReport}
        onClose={() => setViewReport(null)}
        wide
        title="דוח ייבוא"
        subtitle={viewReport ? `${viewReport.batch.file_name} · ${fmtDateTime(viewReport.batch.committed_at ?? viewReport.batch.created_at, tz)}` : undefined}
        footer={
          viewReport?.batch.status === "committed" ? (
            <Button variant="ghost" icon="refresh" onClick={() => rollback(viewReport.batch.id, () => setViewReport(null))}>
              ביטול הייבוא
            </Button>
          ) : undefined
        }
      >
        {viewReport ? (
          <div className="stack-3">
            <div className="row wrap" style={{ gap: 6 }}>
              {Object.entries(viewReport.counts).map(([k, v]) => (
                <Badge key={k} tone={ROW_STATUS[k]?.tone}>
                  {ROW_STATUS[k]?.label ?? k}: {v}
                </Badge>
              ))}
              {viewReport.batch.status === "rolled_back" && <Badge tone="gray">הייבוא בוטל</Badge>}
            </div>
            <ReportRows report={viewReport} />
          </div>
        ) : (
          <Skeleton height={120} />
        )}
      </Sheet>
    </div>
  );
}

function ReportRows({ report }: { report: Report }) {
  const [onlyIssues, setOnlyIssues] = useState(report.rows.some((r) => r.status === "error" || r.status === "needs_review"));
  const rows = onlyIssues ? report.rows.filter((r) => r.status === "error" || r.status === "needs_review") : report.rows;
  return (
    <div className="stack-2">
      <div className="row between">
        <span className="small bold">פירוט לפי שורה</span>
        <button className="chip" aria-pressed={onlyIssues} onClick={() => setOnlyIssues((v) => !v)}>
          רק שורות שדורשות טיפול
        </button>
      </div>
      <div className="table-wrap list" style={{ maxHeight: 360, overflowY: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>שורה</th>
              <th>שם</th>
              <th>תוצאה</th>
              <th>הערה</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.row}>
                <td className="num subtle">{r.row}</td>
                <td className="bold">{r.contactId ? <Link href={`/contacts/${r.contactId}`}>{r.name || "—"}</Link> : r.name || "—"}</td>
                <td>
                  <Badge tone={ROW_STATUS[r.status]?.tone}>{ROW_STATUS[r.status]?.label ?? r.status}</Badge>
                </td>
                <td className="small muted">{r.message ?? ""}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="muted" style={{ textAlign: "center", padding: 20 }}>
                  כל השורות יובאו בלי בעיות
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
