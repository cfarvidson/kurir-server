import type { NextConfig } from "next";

// Empty means the app is served at the host root. A value such as "/kurir"
// is inlined into the client build, so set it before `next build`.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  output: "standalone",
  experimental: {
    // Enables the `"use cache"` directive (without the full cacheComponents
    // static-by-default model). Powers the cached sidebar counts in
    // src/lib/mail/sidebar-counts.ts, invalidated by the existing
    // updateTag("sidebar-counts") calls across src/actions/.
    useCache: true,
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // Don't bundle these Node.js packages - they run server-side only
  serverExternalPackages: [
    "imapflow",
    "nodemailer",
    "mailparser",
    "web-push",
    "pg",
    "@prisma/adapter-pg",
  ],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
