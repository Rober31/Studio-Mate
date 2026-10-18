import { redirect } from "next/navigation";
import { hasAnyStudio, setupCodeRequired } from "@/server/services/team";
import { AuthHeader, SetupForm } from "@/components/AuthForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "הקמת סטודיו" };

export default async function SetupPage() {
  if (await hasAnyStudio()) redirect("/login");
  return (
    <div className="center-screen">
      <div className="auth-card">
        <AuthHeader title="בואו נקים את הסטודיו" subtitle="דקה אחת, ואפשר להתחיל לעבוד." />
        <SetupForm codeRequired={setupCodeRequired()} />
      </div>
    </div>
  );
}
