import type { Config } from "tailwindcss";

const cv = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Helvetica Neue",
          "PingFang SC",
          "Microsoft YaHei",
          "Arial",
          "sans-serif"
        ],
        mono: ["JetBrains Mono", "SFMono-Regular", "Menlo", "monospace"],
        display: ["Inter", "sans-serif"]
      },
      colors: {
        ink: {
          50: cv("--ink-50"),
          100: cv("--ink-100"),
          200: cv("--ink-200"),
          300: cv("--ink-300"),
          400: cv("--ink-400"),
          500: cv("--ink-500"),
          600: cv("--ink-600"),
          700: cv("--ink-700"),
          800: cv("--ink-800"),
          900: cv("--ink-900")
        },
        gold: {
          50: cv("--gold-50"),
          100: cv("--gold-100"),
          200: cv("--gold-200"),
          400: cv("--gold-400"),
          500: cv("--gold-500"),
          600: cv("--gold-600"),
          700: cv("--gold-700")
        },
        gain: {
          50: cv("--gain-50"),
          100: cv("--gain-100"),
          500: cv("--gain-500"),
          600: cv("--gain-500"),
          700: cv("--gain-700")
        },
        loss: {
          50: cv("--loss-50"),
          100: cv("--loss-100"),
          500: cv("--loss-500"),
          600: cv("--loss-500"),
          700: cv("--loss-700")
        },
        canvas: {
          DEFAULT: cv("--canvas"),
          raised: cv("--canvas-raised"),
          sunk: cv("--canvas-sunk")
        },
        hair: {
          DEFAULT: cv("--hair"),
          strong: cv("--hair-strong")
        }
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        pop: "var(--shadow-pop)",
        glow: "0 0 0 3px rgba(var(--gold-500) / 0.18)"
      },
      borderRadius: {
        DEFAULT: "6px",
        lg: "10px",
        xl: "12px"
      },
      transitionTimingFunction: {
        smooth: "cubic-bezier(0.32, 0.72, 0, 1)"
      }
    }
  },
  plugins: []
};

export default config;
