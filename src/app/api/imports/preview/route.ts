import { staffRoute, ok, readJson } from "@/server/http";
import { previewImport, type DateFormat } from "@/server/services/imports";

export const POST = staffRoute(async (req, ctx) => {
  const body = await readJson<{ file_name?: string; content?: string; mapping?: Record<string, string>; date_format?: DateFormat }>(req);
  return ok(await previewImport(ctx, body));
});
