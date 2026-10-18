import { redirect } from "next/navigation";
import { getCtx } from "@/server/auth";
import { hasAnyStudio } from "@/server/services/team";
import { AuthHeader, LoginForm } from "@/components/AuthForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "כניסה" };

export default async function LoginPage() {
  if (!await hasAnyStudio()) redirect("/setup");
  if (await getCtx()) redirect("/");
  return (
    <div className="center-screen">
      <div className="auth-card">
        <AuthHeader title="ברוכים השבים" subtitle="כניסה לצוות הסטודיו" />
        <LoginForm />
      </div>
    </div>
  );
}
