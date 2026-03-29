/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      colors: {
        surface: {
          50: "#fafaf9",
          100: "#f5f5f4",
          200: "#e7e5e4",
        },
        ink: {
          DEFAULT: "#1a1a1a",
          light: "#525252",
          muted: "#a3a3a3",
        },
        accent: {
          DEFAULT: "#e85d04",
          dark: "#c2410c",
          light: "#fed7aa",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["SF Mono", "Fira Code", "Cascadia Code", "Menlo", "monospace"],
      },
      maxWidth: {
        content: "720px",
        landing: "1120px",
      },
    },
  },
  plugins: [],
};
