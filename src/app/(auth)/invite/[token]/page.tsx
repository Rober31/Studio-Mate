import Link from "next/link";
import { inviteInfo } from "@/server/services/team";
import { AuthHeader, InviteForm } from "@/components/AuthForms";
import { ROLE_LABEL } from "@/lib/i18n";

export const dynamic = "force-dynamic";
export const metadata = { title: "הזמנה לצוות" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = inviteInfo(token);
  return (
    <div className="center-screen">
      <div className="auth-card">
        {info ? (
          <>
            <AuthHeader title={`הצטרפות ל${info.studio_name}`} subtitle={`הוזמנת בתור ${ROLE_LABEL[info.role]}`} />
            <InviteForm token={token} email={info.email} hasUser={info.has_user === 1} />
          </>
        ) : (
          <>
            <AuthHeader title="ההזמנה לא בתוקף" subtitle="ייתכן שכבר השתמשו בה או שפג תוקפה. בקשו מבעלי הסטודיו הזמנה חדשה." />
            <Link href="/login" className="btn block">
              לכניסה
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
