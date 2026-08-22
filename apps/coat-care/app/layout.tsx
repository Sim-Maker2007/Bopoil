import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.DELIVERY_PUBLIC_URL || "https://bopoil.ca"),
  title: "Coat & Care — Pet Grooming, Beautifully Simple",
  description: "A calm, complete operating system for pet grooming salons and the people they care for.",
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
