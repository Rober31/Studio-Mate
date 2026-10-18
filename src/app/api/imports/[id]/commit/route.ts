import { staffRoute, ok, readJson } from "@/server/http";
import { commitImport } from "@/server/services/imports";
import { invalid } from "@/server/errors";

export const POST = staffRoute(async (req, ctx, { id }) => {
  const body = await readJson<{ preview_hash?: string }>(req);
  if (!body.preview_hash) throw invalid({ preview_hash: "חסרה תצוגה מקדימה." });
  return ok(commitImport(ctx, id, body.preview_hash));
});
