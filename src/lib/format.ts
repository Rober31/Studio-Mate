import { parsePhoneNumberFromString } from "libphonenumber-js";

const he = "he-IL";

export function fmtDate(iso: string | null | undefined, tz: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(he, { timeZone: tz, ...opts }).format(new Date(iso));
}

export function fmtDateLong(iso: string | null | undefined, tz: string): string {
  return fmtDate(iso, tz, { weekday: "long", day: "numeric", month: "long" });
}

export function fmtDateTime(iso: string | null | undefined, tz: string): string {
  return fmtDate(iso, tz, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function fmtTime(iso: string | null | undefined, tz: string): string {
  return fmtDate(iso, tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** Local calendar date YYYY-MM-DD in a zone (client-safe). */
export function ymd(iso: string | Date, tz: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(typeof iso === "string" ? new Date(iso) : iso);
  return p;
}

export function fmtYmd(value: string | null | undefined): string {
  if (!value) return "";
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(he, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(he, { numeric: "auto" });
  if (abs < 60_000) return "עכשיו";
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), "day");
  return rtf.format(Math.round(diff / (30 * 86_400_000)), "month");
}

export function fmtPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const p = parsePhoneNumberFromString(e164);
  if (!p) return e164;
  return p.country === "IL" ? p.formatNational() : p.formatInternational();
}

export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${Math.round(v * 100)}%`;
}

/** datetime-local input value for "now + minutes" in the browser's zone. */
export function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function tomorrowAt(hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}
