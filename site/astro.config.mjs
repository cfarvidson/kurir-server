import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";

export default defineConfig({
  site: "https://cfarvidson.github.io",
  base: "/kurir-server",
  integrations: [tailwind()],
});
