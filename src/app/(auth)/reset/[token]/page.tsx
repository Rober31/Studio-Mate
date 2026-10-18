import { AuthHeader, ResetForm } from "@/components/AuthForms";

export const metadata = { title: "סיסמה חדשה" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="center-screen">
      <div className="auth-card">
        <AuthHeader title="בחירת סיסמה חדשה" />
        <ResetForm token={token} />
      </div>
    </div>
  );
}
