import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: { default: "StudioMate", template: "%s · StudioMate" },
  description: "מעקב לקוחות ומנויים לסטודיו — מי צריך מעקב היום, הודעה מוכנה לוואטסאפ ונוכחות ב-QR.",
  applicationName: "StudioMate",
  appleWebApp: { capable: true, title: "StudioMate", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1113" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
