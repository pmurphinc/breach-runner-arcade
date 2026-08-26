import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./arena-hud.css";
import "./mirrored-touch-actions.css";
import { PRODUCT_TAGLINE, PRODUCT_TITLE } from "./product";

const PRODUCTION_URL = "https://breachrunner.murphtournaments.com";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
  themeColor: "#02050a",
};

export const metadata: Metadata = {
  metadataBase: new URL(PRODUCTION_URL),
  title: PRODUCT_TITLE,
  description: PRODUCT_TAGLINE,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: PRODUCT_TITLE,
    description: PRODUCT_TAGLINE,
    url: PRODUCTION_URL,
    siteName: PRODUCT_TITLE,
    type: "website",
    images: [
      {
        url: "/og.png?v=breach-runner-1",
        width: 1200,
        height: 630,
        alt: "Breach Runner — Weaponize the Rift",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: PRODUCT_TITLE,
    description: PRODUCT_TAGLINE,
    images: ["/og.png?v=breach-runner-1"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.png", type: "image/png", sizes: "64x64" },
    ],
    shortcut: "/favicon.ico",
    apple: { url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
