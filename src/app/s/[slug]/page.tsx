import { notFound } from "next/navigation";
import { getStudioBySlug } from "@/server/studio";
import { RegistrationForm } from "@/components/public/RegistrationForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const studio = getStudioBySlug(slug);
  return { title: studio ? `הרשמה · ${studio.name}` : "הרשמה", robots: { index: false } };
}

export default async function RegisterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const studio = getStudioBySlug(slug);
  if (!studio || !studio.modules.includes("qr")) notFound();
  return (
    <div className="center-screen">
      <RegistrationForm slug={slug} studioName={studio.name} defaultCountry={studio.default_country} noticeText={studio.settings.noticeText} />
    </div>
  );
}
