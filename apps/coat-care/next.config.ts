import type { NextConfig } from "next";
import path from "node:path";

const monorepoRoot = path.resolve(process.cwd(), "../..");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  // Product pages wear boutique.html's header, cart and footer
  // (lib/storefront.ts), read from the copy the build puts in public/.
  outputFileTracingIncludes: {
    "/boutique/produit/*": ["./public/boutique.html"],
  },
  turbopack: { root: monorepoRoot },
  // The boutique's product photos are Square's original uploads, often 2 000
  // to 3 000 pixels a side. apps/web/js/cart.js shows them through
  // /_next/image at 256 to 1 080 pixels instead; decoded in full, the catalog
  // weighed over 2 GB and iOS Safari kept reloading the page. The addresses
  // are content-hashed (a new photo gets a new address), so a resized photo
  // can be cached for a year.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "items-images-production.s3.us-west-2.amazonaws.com", pathname: "/files/**", search: "" }],
    qualities: [75],
    minimumCacheTTL: 31536000,
  },
  // Addresses inherited from the former Square Online site. A real redirect
  // passes ranking signals to the new page; the old meta-refresh stubs did not.
  async redirects() {
    return [
      { source: "/home.html", destination: "/", permanent: true },
      { source: "/contact.html", destination: "/contactez-nous.html", permanent: true },
      { source: "/services.html", destination: "/nos-services.html", permanent: true },
      { source: "/fichedinformations.html", destination: "/fiche-informations.html", permanent: true },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [{ source: "/", destination: "/index.html" }],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/images/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/fonts/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/:path*.html", headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }] },
    ];
  },
};

export default nextConfig;
