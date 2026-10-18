import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getStudioBySlug } from "@/server/studio";
import { memberFromToken, MEMBER_COOKIE } from "@/server/services/public";
import { CheckinClient } from "@/components/public/CheckinClient";
import { PublicMessage } from "@/components/public/PublicMessage";

export const dynamic = "force-dynamic";
export const metadata = { title: "רישום נוכחות", robots: { index: false } };

export default async function CheckinPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ t?: string }> }) {
  const { slug } = await params;
  const { t } = await searchParams;
  const studio = getStudioBySlug(slug);
  if (!studio || !studio.modules.includes("qr")) notFound();
  const jar = await cookies();
  const member = memberFromToken(jar.get(MEMBER_COOKIE)?.value, studio.id);
  if (!t) {
    return <PublicMessage studioName={studio.name} icon="qr" title="סרקו את הקוד שעל המסך" text="הקוד לרישום נוכחות מוצג בכניסה לסטודיו ומתחלף כל דקה." />;
  }
  if (!member) {
    return (
      <PublicMessage
        studioName={studio.name}
        icon="smartphone"
        title="צריך לחבר את הטלפון פעם אחת"
        text="כדי לרשום נוכחות מהטלפון, בקשו בקבלה קישור חיבור. אחרי החיבור פשוט סורקים את הקוד בכל שיעור."
        note="מטעמי פרטיות אי אפשר לרשום נוכחות לפי מספר טלפון בלבד."
      />
    );
  }
  return <CheckinClient slug={slug} token={t} studioName={studio.name} firstName={member.firstName} />;
}
