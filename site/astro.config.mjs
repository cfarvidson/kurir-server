import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";

export default defineConfig({
  site: "https://kurir.io",
  base: "/",
  integrations: [tailwind()],
});
