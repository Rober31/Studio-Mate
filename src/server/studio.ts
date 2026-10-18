import { one, run } from "./db";
import { parseJson, nowIso } from "./util";

export type ModuleKey = "crm" | "ai" | "qr";

export type RuleKey = "R01" | "R02" | "R03" | "R04" | "R05" | "R06" | "R07";

export type StudioSettings = {
  rules: Record<RuleKey, { enabled: boolean; days?: number; threshold?: number }>;
  cooldownHours: number; // waiting period between marketing contacts
  maxContactsPer7Days: number;
  qrRotateSeconds: number;
  checkinWindowBeforeMin: number;
  checkinWindowAfterMin: number;
  messageLanguage: "he" | "ar" | "en";
  studioStyle: string; // short description of the studio voice for drafts
  signature: string;
  noticeVersion: string;
  noticeText: string;
  aiMonthlyQuota: number;
  importFreshnessHours: number;
  businessHours: { start: string; end: string };
};

export const DEFAULT_SETTINGS: StudioSettings = {
  rules: {
    R01: { enabled: true, days: 1 },
    R02: { enabled: true, days: 1 },
    R03: { enabled: true, days: 5 },
    R04: { enabled: true, threshold: 2 },
    R05: { enabled: true, days: 14 },
    R06: { enabled: true },
    R07: { enabled: false, days: 14 },
  },
  cooldownHours: 48,
  maxContactsPer7Days: 2,
  qrRotateSeconds: 60,
  checkinWindowBeforeMin: 15,
  checkinWindowAfterMin: 15,
  messageLanguage: "he",
  studioStyle: "חם, אישי וקצר. בלי לחץ ובלי הבטחות.",
  signature: "",
  noticeVersion: "v1",
  noticeText:
    "הפרטים ישמשו את הסטודיו כדי לחזור אליך בנוגע להרשמה ולשיעורים. אפשר לבקש בכל עת שלא נפנה אליך יותר.",
  aiMonthlyQuota: 500,
  importFreshnessHours: 168,
  businessHours: { start: "08:00", end: "21:00" },
};

export type Studio = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  locale: string;
  default_country: string;
  modules: ModuleKey[];
  settings: StudioSettings;
  status: string;
};

type StudioRow = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  locale: string;
  default_country: string;
  enabled_modules: string;
  settings: string;
  status: string;
};

export function mergeSettings(raw: Partial<StudioSettings>): StudioSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    rules: { ...DEFAULT_SETTINGS.rules, ...(raw.rules ?? {}) },
    businessHours: { ...DEFAULT_SETTINGS.businessHours, ...(raw.businessHours ?? {}) },
  };
}

export function toStudio(row: StudioRow): Studio {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    locale: row.locale,
    default_country: row.default_country,
    modules: parseJson<ModuleKey[]>(row.enabled_modules, ["crm", "ai", "qr"]),
    settings: mergeSettings(parseJson<Partial<StudioSettings>>(row.settings, {})),
    status: row.status,
  };
}

export function getStudio(id: string): Studio | undefined {
  const row = one<StudioRow>("SELECT * FROM studios WHERE id = ?", id);
  return row ? toStudio(row) : undefined;
}

export function getStudioBySlug(slug: string): Studio | undefined {
  const row = one<StudioRow>("SELECT * FROM studios WHERE slug = ? AND status = 'active'", slug);
  return row ? toStudio(row) : undefined;
}

export function saveStudio(studio: Pick<Studio, "id" | "name" | "timezone" | "locale" | "modules" | "settings">) {
  run(
    "UPDATE studios SET name = ?, timezone = ?, locale = ?, enabled_modules = ?, settings = ?, updated_at = ? WHERE id = ?",
    studio.name,
    studio.timezone,
    studio.locale,
    JSON.stringify(studio.modules),
    JSON.stringify(studio.settings),
    nowIso(),
    studio.id,
  );
}
