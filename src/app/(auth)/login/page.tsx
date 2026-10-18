import { redirect } from "next/navigation";
import { getCtx } from "@/server/auth";
import { hasAnyStudio } from "@/server/services/team";
import { AuthHeader, LoginForm } from "@/components/AuthForms";
import { isDemo } from "@/server/db";
import { DEMO_LOGIN } from "@/server/demo";

export const dynamic = "force-dynamic";
export const metadata = { title: "כניסה" };

export default async function LoginPage() {
  if (!await hasAnyStudio()) redirect("/setup");
  if (await getCtx()) redirect("/");
  return (
    <div className="center-screen">
      <div className="auth-card">
        <AuthHeader title="ברוכים השבים" subtitle="כניסה לצוות הסטודיו" />
        {isDemo() && (
          <div className="banner" style={{ marginBottom: 16 }}>
            <div className="small">
              <div className="bold">גרסת הדגמה עם נתוני דוגמה</div>
              <div>
                אימייל: <span className="ltr">{DEMO_LOGIN.email}</span> · סיסמה: <span className="ltr">{DEMO_LOGIN.password}</span>
              </div>
              <div className="subtle xsmall">הנתונים מתאפסים מדי פעם. צוות: staff@studiomate.app · מדריכה: instructor@studiomate.app</div>
            </div>
          </div>
        )}
        <LoginForm />
      </div>
    </div>
  );
}
