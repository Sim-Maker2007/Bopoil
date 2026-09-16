import type { Metadata, Viewport } from "next";
import "./globals.css";

// Booking is used mostly on phones: let the layout extend under the notch and
// home indicator so sticky bars can pad themselves with env(safe-area-inset-*).
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export const metadata: Metadata = {
  metadataBase: new URL(process.env.DELIVERY_PUBLIC_URL || "https://www.bopoil.ca"),
  title: "Coat & Care — Pet Grooming, Beautifully Simple",
  description: "A calm, complete operating system for pet grooming salons and the people they care for.",
  // Coat & Care shares the bopoil.ca domain with the public website. Its
  // workspace, portal and booking routes are private tools, never search results.
  robots: { index: false, follow: false },
  openGraph: {
    title: "Coat & Care",
    description: "Pet grooming, beautifully simple.",
    type: "website",
    images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "Coat & Care — Pet grooming, beautifully simple" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Coat & Care",
    description: "Pet grooming, beautifully simple.",
    images: ["/og.jpg"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
