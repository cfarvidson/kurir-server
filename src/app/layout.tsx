import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

// Editorial serif used for reading-pane subject headlines.
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
});

export const metadata: Metadata = {
  title: "Kurir - Email for Humans",
  description: "A calm, focused email experience inspired by Hey.com",
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png", sizes: "32x32" }],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${playfair.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
