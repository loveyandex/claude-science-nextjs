import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
        mono: ["var(--font-mono)"],
        serif: ["var(--font-serif)"],
      },
      colors: {
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--border) / <alpha-value>)",
        ring: "hsl(var(--accent) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        sidebar: {
          DEFAULT: "hsl(var(--sidebar) / <alpha-value>)",
          foreground: "hsl(var(--foreground) / <alpha-value>)",
        },
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--foreground) / <alpha-value>)",
        },
        "user-message": "hsl(var(--user-message) / <alpha-value>)",
        muted: {
          DEFAULT: "hsl(var(--sidebar) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(0 0% 100% / <alpha-value>)",
        },
        // Status colors from the CDS palette (see globals.css layer 3) —
        // used by the embedding pipeline UI for done/in-flight/queued
        // states instead of reaching for raw Tailwind palette classes.
        success: {
          DEFAULT: "hsl(var(--success) / <alpha-value>)",
          foreground: "hsl(0 0% 100% / <alpha-value>)",
        },
        warning: {
          DEFAULT: "hsl(var(--warning) / <alpha-value>)",
          foreground: "hsl(0 0% 0% / <alpha-value>)",
        },
        info: {
          DEFAULT: "hsl(var(--info) / <alpha-value>)",
          foreground: "hsl(0 0% 100% / <alpha-value>)",
        },
        // Direct access to the CDS surface ramp for the rare case a
        // component needs a specific step rather than a semantic role.
        surface: {
          "000": "hsl(var(--bg-000) / <alpha-value>)",
          "100": "hsl(var(--bg-100) / <alpha-value>)",
          "200": "hsl(var(--bg-200) / <alpha-value>)",
          "300": "hsl(var(--bg-300) / <alpha-value>)",
          "400": "hsl(var(--bg-400) / <alpha-value>)",
        },
      },
      borderRadius: {
        lg: "0.75rem",
        md: "0.5rem",
        sm: "0.375rem",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        // Indeterminate "work is happening" sheen for progress bars whose
        // total isn't known yet (a page whose chunk count is still being
        // computed) — see components/embedding/progress-bar.tsx.
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(200%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "slide-up": "slide-up 0.25s ease-out",
        shimmer: "shimmer 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
