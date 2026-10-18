// Time-zone helpers. Data is stored in UTC; studio-local calendar logic
// (day boundaries, "end date includes the selected day") uses the studio's IANA zone.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function parts(date: Date, timeZone: string) {
  const fmt = formatter(timeZone);
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

function offsetMs(date: Date, timeZone: string): number {
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converts a wall-clock time in the given zone to a UTC Date (DST-safe). */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ts = guess - offsetMs(new Date(guess), timeZone);
  ts = guess - offsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

/** "YYYY-MM-DD" of the given instant in the zone. */
export function localDate(date: Date | string, timeZone: string): string {
  const p = parts(typeof date === "string" ? new Date(date) : date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "HH:MM" of the given instant in the zone. */
export function localTime(date: Date | string, timeZone: string): string {
  const p = parts(typeof date === "string" ? new Date(date) : date, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** UTC instant for the start of a local calendar day. */
export function startOfLocalDay(ymd: string, timeZone: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return zonedToUtc(y, m, d, 0, 0, timeZone);
}

export function addLocalDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Inclusive end date chosen in the UI → exclusive UTC boundary (start of next local day). */
export function endDateToExclusive(ymd: string, timeZone: string): string {
  return startOfLocalDay(addLocalDays(ymd, 1), timeZone).toISOString();
}

/** Exclusive boundary → the inclusive local end date shown in the UI. */
export function exclusiveToEndDate(iso: string, timeZone: string): string {
  return localDate(new Date(new Date(iso).getTime() - 1), timeZone);
}

export function localDateTimeToUtc(ymd: string, hhmm: string, timeZone: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  return zonedToUtc(y, m, d, hh, mm, timeZone).toISOString();
}

/** Whole local days between two instants (b - a), DST-safe. */
export function localDayDiff(a: Date | string, b: Date | string, timeZone: string): number {
  const da = localDate(a, timeZone);
  const db = localDate(b, timeZone);
  return Math.round((Date.parse(db) - Date.parse(da)) / 86_400_000);
}
