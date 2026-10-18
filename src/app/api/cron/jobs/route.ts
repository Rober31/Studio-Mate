import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runJobsOnce } from "@/server/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = crypto.createHash("sha256").update(req.headers.get("authorization") ?? "").digest();
  const want = crypto.createHash("sha256").update(`Bearer ${secret}`).digest();
  return crypto.timingSafeEqual(got, want);
}

/** Daily maintenance for Vercel Cron: rule evaluation per studio and token cleanup. */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: { code: "unauthenticated", message: "Unauthorized" } }, { status: 401 });
  try {
    const started = Date.now();
    const result = await runJobsOnce();
    return NextResponse.json({ data: { ...result, duration_ms: Date.now() - started } });
  } catch (e) {
    console.error("[cron] jobs failed", e);
    return NextResponse.json({ error: { code: "unavailable", message: "Jobs failed" } }, { status: 500 });
  }
}
