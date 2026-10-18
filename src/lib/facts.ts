import { fmtYmd } from "./format";

export type FactsLike = {
  rule?: string;
  first_name?: string;
  language?: string;
  plan_name?: string;
  end_date?: string;
  days_left?: number;
  balance?: number;
  last_attendance?: string;
  days_since_attendance?: number;
  trial_date?: string;
  ended_date?: string;
  interest?: string;
  due_at?: string;
};

/** Short human explanation of why this person needs a follow-up. */
export function factsLine(rule: string, f: FactsLike | undefined): string {
  if (!f) return "";
  switch (rule) {
    case "R03":
      return [f.plan_name, f.end_date ? `מסתיים ${fmtYmd(f.end_date)}` : null, typeof f.days_left === "number" ? (f.days_left === 0 ? "היום" : f.days_left === 1 ? "מחר" : `עוד ${f.days_left} ימים`) : null]
        .filter(Boolean)
        .join(" · ");
    case "R04":
      return [typeof f.balance === "number" ? (f.balance === 1 ? "נשאר שיעור אחד" : `נשארו ${f.balance} שיעורים`) : null, f.plan_name].filter(Boolean).join(" · ");
    case "R05":
      return [typeof f.days_since_attendance === "number" ? `לא הגיע/ה ${f.days_since_attendance} ימים` : null, f.last_attendance ? `ביקור אחרון ${fmtYmd(f.last_attendance)}` : "עוד לא הגיע/ה"]
        .filter(Boolean)
        .join(" · ");
    case "R02":
      return f.trial_date ? `שיעור ניסיון ${fmtYmd(f.trial_date)}` : "היה/תה בשיעור ניסיון";
    case "R07":
      return [f.plan_name, f.ended_date ? `הסתיים ${fmtYmd(f.ended_date)}` : null].filter(Boolean).join(" · ");
    case "R01":
      return f.interest ? `מתעניין/ת ב${f.interest}` : "עוד לא נוצר קשר";
    default:
      return f.plan_name ?? "";
  }
}

/** Facts shown to staff before the draft text, with their source (AI-03). */
export function factChips(f: FactsLike | undefined): { label: string; value: string }[] {
  if (!f) return [];
  const out: { label: string; value: string }[] = [];
  if (f.plan_name) out.push({ label: "מסלול", value: f.plan_name });
  if (f.end_date) out.push({ label: "סיום", value: fmtYmd(f.end_date) });
  if (typeof f.days_left === "number") out.push({ label: "ימים לסיום", value: String(f.days_left) });
  if (typeof f.balance === "number") out.push({ label: "יתרה", value: String(f.balance) });
  if (f.last_attendance) out.push({ label: "ביקור אחרון", value: fmtYmd(f.last_attendance) });
  if (typeof f.days_since_attendance === "number") out.push({ label: "ימים בלי הגעה", value: String(f.days_since_attendance) });
  if (f.trial_date) out.push({ label: "ניסיון", value: fmtYmd(f.trial_date) });
  if (f.ended_date) out.push({ label: "הסתיים", value: fmtYmd(f.ended_date) });
  if (f.interest) out.push({ label: "תחום עניין", value: f.interest });
  return out;
}

export const FACT_SOURCE: Record<string, string> = {
  R01: "תיק הלקוח",
  R02: "רישום נוכחות + תיק הלקוח",
  R03: "פרטי המנוי",
  R04: "יומן שיעורים של המנוי",
  R05: "רישומי נוכחות + המנוי",
  R06: "משימה שנקבעה",
  R07: "פרטי המנוי",
  GENERAL: "תיק הלקוח",
};
