// Hebrew UI vocabulary. Keys stay in English in the data layer; every
// user-facing label lives here so additional UI languages can be added later.

export const STAGE_LABEL: Record<string, string> = {
  new_lead: "ליד חדש",
  contacted: "נוצר קשר",
  trial_scheduled: "נקבע ניסיון",
  trial_attended: "היה/תה בניסיון",
  decision_pending: "ממתין להחלטה",
  converted: "מנוי/ה",
  lost: "לא רלוונטי",
};

export const STAGE_TONE: Record<string, "blue" | "purple" | "orange" | "green" | "gray" | "accent" | "red"> = {
  new_lead: "blue",
  contacted: "purple",
  trial_scheduled: "orange",
  trial_attended: "orange",
  decision_pending: "accent",
  converted: "green",
  lost: "gray",
};

export const STAGE_ORDER = ["new_lead", "contacted", "trial_scheduled", "trial_attended", "decision_pending", "converted", "lost"];

export const RULE_LABEL: Record<string, string> = {
  R01: "ליד חדש שעוד לא דיברו איתו",
  R02: "היה/תה בשיעור ניסיון ועוד לא נרשם/ה",
  R03: "המנוי מסתיים בקרוב",
  R04: "נשארו מעט שיעורים בכרטיסייה",
  R05: "לא הגיע/ה כבר זמן מה",
  R06: "מעקב שנקבע",
  R07: "מנוי שהסתיים לאחרונה",
  TASK: "משימה",
  REG: "בקשת הרשמה לבדיקה",
  GENERAL: "מעקב כללי",
};

export const RULE_SHORT: Record<string, string> = {
  R01: "ליד חדש",
  R02: "אחרי ניסיון",
  R03: "חידוש מנוי",
  R04: "יתרה נמוכה",
  R05: "לא מגיע/ה",
  R06: "מעקב שנקבע",
  R07: "החזרה",
  TASK: "משימה",
  REG: "הרשמה",
  GENERAL: "מעקב",
};

export const RULE_ACTION: Record<string, string> = {
  R01: "הכנת הודעת היכרות",
  R02: "שאלה על הניסיון",
  R03: "הכנת תזכורת חידוש",
  R04: "הצעת חידוש",
  R05: "הודעת התעניינות",
  R06: "הכנת הודעה",
  R07: "הודעת חזרה",
  TASK: "הכנת הודעה",
  GENERAL: "הכנת הודעה",
};

export const RULE_ICON: Record<string, string> = {
  R01: "user_plus",
  R02: "star",
  R03: "calendar",
  R04: "wallet",
  R05: "clock",
  R06: "tasks",
  R07: "refresh",
  TASK: "tasks",
  REG: "qr",
};

export const OUTCOME_LABEL: Record<string, string> = {
  no_answer: "לא ענה/תה",
  interested: "מעוניין/ת",
  needs_time: "צריך/ה זמן",
  asked_details: "ביקש/ה פרטים",
  wants_trial: "רוצה שיעור ניסיון",
  renewed: "חידש/ה מנוי",
  not_interested: "לא מעוניין/ת",
  stop_contact: "ביקש/ה להפסיק קשר",
};

export const OUTCOME_ICON: Record<string, string> = {
  no_answer: "phone",
  interested: "star",
  needs_time: "clock",
  asked_details: "info",
  wants_trial: "calendar",
  renewed: "checkCircle",
  not_interested: "xCircle",
  stop_contact: "ban",
};

export const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "וואטסאפ",
  call: "שיחת טלפון",
  in_person: "פנים אל פנים",
  none: "בלי ליצור קשר",
  other: "אחר",
  qr: "QR",
  manual: "ידני",
  external: "מערכת חיצונית",
  import: "ייבוא",
  system: "מערכת",
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  open: "פתוחה",
  in_progress: "בטיפול",
  snoozed: "נדחתה",
  completed: "הושלמה",
  dismissed: "הוחרגה",
  superseded: "כבר לא רלוונטית",
};

export const MEMBERSHIP_STATUS_LABEL: Record<string, string> = {
  pending: "מתחיל בעתיד",
  active: "פעיל",
  paused: "מוקפא",
  expired: "הסתיים",
  exhausted: "היתרה נגמרה",
  cancelled: "בוטל",
};

export const MEMBERSHIP_STATUS_TONE: Record<string, "green" | "orange" | "red" | "blue" | "gray" | "purple"> = {
  pending: "blue",
  active: "green",
  paused: "purple",
  expired: "gray",
  exhausted: "orange",
  cancelled: "red",
};

export const PLAN_TYPE_LABEL: Record<string, string> = {
  period: "מנוי לתקופה",
  punch: "כרטיסיית שיעורים",
  punch_period: "כרטיסייה לתקופה",
  trial: "שיעור ניסיון",
};

export const SESSION_STATUS_LABEL: Record<string, string> = {
  scheduled: "מתוכנן",
  open: "פתוח לרישום",
  completed: "הסתיים",
  cancelled: "בוטל",
};

export const ATTENDANCE_STATUS_LABEL: Record<string, string> = {
  present: "נוכח/ת",
  reversed: "בוטל",
  pending_reconciliation: "ממתין לאישור",
};

export const DRAFT_STATUS_LABEL: Record<string, string> = {
  ready: "מוכנה",
  edited: "נערכה",
  wa_opened: "נפתחה בוואטסאפ",
  marked_sent: "סומנה כנשלחה",
  outcome_recorded: "תועדה תוצאה",
  invalidated: "בוטלה",
};

export const SOURCE_LABEL: Record<string, string> = {
  manual: "הוזן ידנית",
  qr: "הרשמה ב-QR",
  import: "ייבוא",
  referral: "המלצה",
  instagram: "אינסטגרם",
  facebook: "פייסבוק",
  website: "אתר",
  walk_in: "הגיע/ה לסטודיו",
};

export const LANG_LABEL: Record<string, string> = { he: "עברית", ar: "ערבית", en: "אנגלית" };

export const ROLE_LABEL: Record<string, string> = {
  owner: "בעלים",
  staff: "עובד/ת מעקב",
  instructor: "מדריך/ה או קבלה",
};

export const WARNING_LABEL: Record<string, string> = {
  ai_not_configured: "עוזר הניסוח לא מחובר, לכן הוכנה הודעה מתבנית קבועה.",
  ai_unavailable: "עוזר הניסוח לא זמין כרגע, לכן הוכנה הודעה מתבנית קבועה.",
  ai_timeout: "עוזר הניסוח לא ענה בזמן, לכן הוכנה הודעה מתבנית קבועה.",
  ai_rate_limited: "יותר מדי בקשות לעוזר הניסוח. הוכנה הודעה מתבנית קבועה.",
  ai_auth_error: "יש בעיה בחיבור לעוזר הניסוח. הוכנה הודעה מתבנית קבועה.",
  ai_invalid_output: "ההצעה של עוזר הניסוח לא עברה בדיקה, לכן הוכנה הודעה מתבנית קבועה.",
  ai_refused: "עוזר הניסוח לא הכין הצעה, לכן הוכנה הודעה מתבנית קבועה.",
  ai_quota_reached: "נוצלה מכסת ההצעות החודשית. הוכנה הודעה מתבנית קבועה.",
  missing_plan: "חסר שם מסלול, ולכן הוא לא מופיע בהודעה.",
  phone_invalid: "מספר הטלפון חסר או לא תקין — צריך לתקן לפני פתיחת וואטסאפ.",
  cooldown_override: "ההודעה הוכנה למרות פנייה לאחרונה (נרשמה סיבה).",
};

export const INVALID_REASON_LABEL: Record<string, string> = {
  facts_changed: "הנתונים של הלקוח השתנו",
  reason_cleared: "הסיבה למעקב כבר לא רלוונטית",
  contact_blocked: "הלקוח ביקש שלא ניצור קשר",
  membership_changed: "המנוי השתנה",
  phone_changed: "מספר הטלפון השתנה",
  dismissed: "הסיבה הוחרגה",
};

export const EXCLUDED_LABEL: Record<string, string> = {
  blocked: "ביקש/ה שלא ניצור קשר",
  cooldown: "פנו אליו/ה לאחרונה (תקופת המתנה)",
  limit: "הגיע/ה למספר הפניות המרבי השבוע",
};

export function eventLabel(title: string): string {
  if (title.startsWith("stage:")) {
    if (title === "stage:created") return "התיק נוצר";
    const [, pair] = title.split(":");
    const [from, to] = pair.split(">");
    return `שלב: ${STAGE_LABEL[from] ?? from} ← ${STAGE_LABEL[to] ?? to}`;
  }
  if (title.startsWith("event:")) {
    const [, type, outcome] = title.split(":");
    const map: Record<string, string> = {
      wa_opened: "נפתחה הודעה בוואטסאפ",
      marked_sent: "ההודעה סומנה כנשלחה",
      outcome_recorded: "תועדה תוצאת מעקב",
      attendance: "נוכחות בשיעור",
      registration: "בקשת הרשמה ב-QR",
      renewal: "חידוש מנוי מתועד",
      membership_created: "נוצר מנוי",
      call: "שיחת טלפון",
    };
    return `${map[type] ?? type}${outcome ? ` · ${OUTCOME_LABEL[outcome] ?? outcome}` : ""}`;
  }
  if (title === "note") return "הערה";
  if (title === "consent:allowed") return "אושרה יצירת קשר";
  if (title === "consent:blocked") return "נחסמה יצירת קשר";
  return title;
}
