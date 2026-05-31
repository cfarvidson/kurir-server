import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://kurir.io",
  base: "/",
  vite: {
    plugins: [tailwindcss()],
  },
});
