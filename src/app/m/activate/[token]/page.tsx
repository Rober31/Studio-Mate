import { activationInfo } from "@/server/services/public";
import { ActivateClient } from "@/components/public/ActivateClient";
import { PublicMessage } from "@/components/public/PublicMessage";

export const dynamic = "force-dynamic";
export const metadata = { title: "חיבור הטלפון", robots: { index: false } };

export default async function ActivatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = activationInfo(token);
  if (!info) {
    return <PublicMessage icon="link" title="הקישור כבר לא בתוקף" text="ייתכן שכבר השתמשו בו או שעברו 24 שעות. בקשו קישור חדש בקבלה." />;
  }
  return <ActivateClient token={token} studioName={info.studioName} firstName={info.firstName} />;
}
