import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./arena-hud.css";
import "./mirrored-touch-actions.css";
import { PRODUCT_DESCRIPTION, PRODUCT_TAGLINE, PRODUCT_TITLE } from "./product";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
  themeColor: "#02050a",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://wormhole-arcade.pmurphinc.chatgpt.site"),
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
