import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
  themeColor: "#02050a",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://wormhole-arcade.pmurphinc.chatgpt.site"),
  title: "Wormhole Arcade",
  description: "A playable browser recreation of the fast-paced Centerfleet space-combat classic.",
  openGraph: {
    title: "Wormhole Arcade",
    description: "Shoot the wormhole. Collect the power. Send it back.",
    type: "website",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "Wormhole Arcade — Survive the Void" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Wormhole Arcade",
    description: "Shoot the wormhole. Collect the power. Send it back.",
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
