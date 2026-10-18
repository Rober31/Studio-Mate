import { staffRoute } from "@/server/http";
import { exportContactsCsv } from "@/server/services/imports";

export const GET = staffRoute((_req, ctx) => {
  const csv = exportContactsCsv(ctx);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="studiomate-contacts-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
});
