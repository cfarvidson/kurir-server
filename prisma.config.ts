import { defineConfig } from "prisma/config";

// DATABASE_URL is supplied via .env (dev) or the container environment (prod).
// Kept dotenv-free so the file loads in the slim production runner image.
export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
