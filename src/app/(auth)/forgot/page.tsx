import Link from "next/link";
import { AuthHeader } from "@/components/AuthForms";

export const metadata = { title: "שכחתי סיסמה" };

export default function ForgotPage() {
  return (
    <div className="center-screen">
      <div className="auth-card">
        <AuthHeader title="שכחת סיסמה?" subtitle="בעלי הסטודיו יכולים ליצור לך קישור לבחירת סיסמה חדשה." />
        <div className="stack-3 small muted">
          <p>בקשו מבעלי הסטודיו להיכנס אל הגדרות ← צוות, וללחוץ על &quot;קישור לסיסמה חדשה&quot; ליד השם שלך. הקישור תקף ל-24 שעות.</p>
          <p>אם את/ה בעלי הסטודיו ואין בעלים נוספים, פנו לאחראי הטכני של המערכת.</p>
        </div>
        <Link href="/login" className="btn block" style={{ marginTop: 24 }}>
          חזרה לכניסה
        </Link>
      </div>
    </div>
  );
}
