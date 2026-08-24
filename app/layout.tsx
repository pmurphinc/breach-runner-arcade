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
  metadataBase: new URL("https://wormhole-arcade.pmurphinc.chatgpt.site"),
  title: PRODUCT_TITLE,
  description: PRODUCT_DESCRIPTION,
  openGraph: {
    title: PRODUCT_TITLE,
    description: PRODUCT_TAGLINE,
    type: "website",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: `${PRODUCT_TITLE} — space combat` }],
  },
  twitter: {
    card: "summary_large_image",
    title: PRODUCT_TITLE,
    description: PRODUCT_TAGLINE,
    images: ["/og.png"],
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
