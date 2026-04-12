import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Enable server actions
  experimental: {
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
  devIndicators: {
    buildActivityPosition: "bottom-right",
  },
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
