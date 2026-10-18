import { redirect } from "next/navigation";
import { getCtx } from "@/server/auth";
import { homePath } from "@/server/nav";
import { hasAnyStudio } from "@/server/services/team";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!hasAnyStudio()) redirect("/setup");
  const ctx = await getCtx();
  redirect(ctx ? homePath(ctx) : "/login");
}
