import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
  ],
};

export default nextConfig;
