import { staffRoute, ok, readJson } from "@/server/http";
import { updateStudioSettings } from "@/server/services/team";
import { assertCan } from "@/server/permissions";
import type { ModuleKey, StudioSettings } from "@/server/studio";

export const GET = staffRoute((_req, ctx) => {
  assertCan(ctx, "settings");
  const s = ctx.studio;
  return ok({ name: s.name, slug: s.slug, timezone: s.timezone, modules: s.modules, settings: s.settings, aiConfigured: !!process.env.ANTHROPIC_API_KEY });
});

export const PATCH = staffRoute(async (req, ctx) => {
  const body = await readJson<{ name?: string; timezone?: string; modules?: ModuleKey[]; settings?: Partial<StudioSettings> }>(req);
  const s = updateStudioSettings(ctx, body);
  return ok({ name: s.name, slug: s.slug, timezone: s.timezone, modules: s.modules, settings: s.settings });
});
