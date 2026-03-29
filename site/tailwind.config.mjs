/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      colors: {
        surface: {
          50: "#faf9f7",
          100: "#f5f4f1",
          200: "#e8e6e1",
        },
        ink: {
          DEFAULT: "#1a1510",
          light: "#57534e",
          muted: "#a8a29e",
        },
        accent: {
          DEFAULT: "#c54b15",
          dark: "#9a3412",
          light: "#fed7aa",
          glow: "#fb923c",
        },
      },
      fontFamily: {
        display: ["DM Serif Display", "Georgia", "serif"],
        sans: [
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: ["SF Mono", "Fira Code", "Cascadia Code", "Menlo", "monospace"],
      },
      maxWidth: {
        content: "720px",
        landing: "1120px",
      },
      animation: {
        "fade-in": "fadeIn 0.8s ease-out both",
        "slide-up": "slideUp 0.8s ease-out both",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(24px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
