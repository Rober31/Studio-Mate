import { staffRoute } from "@/server/http";
import { exportAttendanceCsv } from "@/server/services/attendance";
import { toCsv } from "@/server/services/imports";
import { invalid } from "@/server/errors";
import { CHANNEL_LABEL, ATTENDANCE_STATUS_LABEL } from "@/lib/i18n";
import { localDate, localTime } from "@/server/time";

export const GET = staffRoute(async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw invalid({ from: "טווח תאריכים לא תקין." });
  const rows = await exportAttendanceCsv(ctx, new Date(from).toISOString(), new Date(to).toISOString(), sp.get("session_id") || undefined);
  const tz = ctx.studio.timezone;
  const csv = toCsv(
    ["תאריך", "שעה", "שיעור", "שם", "מסלול", "מצב", "ערוץ", "זמן רישום"],
    rows.map((r) => [
      localDate(r.start_at, tz),
      localTime(r.start_at, tz),
      r.title,
      r.name,
      r.plan ?? "",
      ATTENDANCE_STATUS_LABEL[r.status] ?? r.status,
      CHANNEL_LABEL[r.channel] ?? r.channel,
      `${localDate(r.checked_in_at, tz)} ${localTime(r.checked_in_at, tz)}`,
    ]),
  );
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="attendance-${localDate(from, tz)}.csv"`,
      "cache-control": "no-store",
    },
  });
});
