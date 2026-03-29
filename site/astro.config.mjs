import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";

export default defineConfig({
  site: "https://cfarvidson.github.io",
  base: process.env.LOCAL_DEV ? "/" : "/kurir-server/",
  integrations: [tailwind()],
});
