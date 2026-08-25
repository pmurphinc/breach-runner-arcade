import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PRODUCT_DESCRIPTION, PRODUCT_TAGLINE, PRODUCT_TITLE } from "./product";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
  themeColor: "#02050a",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://breachrunner.murphtournaments.com"),
  title: PRODUCT_TITLE,
  description: PRODUCT_DESCRIPTION,
  openGraph: {
    title: PRODUCT_TITLE,
    description: PRODUCT_TAGLINE,
    type: "website",
  },
  twitter: {
    card: "summary",
    title: PRODUCT_TITLE,
    description: PRODUCT_TAGLINE,
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
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
