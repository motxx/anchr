/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Dark-first palette (Linear-inspired)
        background: "#09090b",        // zinc-950
        surface: "#18181b",           // zinc-900
        "surface-raised": "#27272a",  // zinc-800
        foreground: "#fafafa",        // zinc-50
        muted: "#3f3f46",            // zinc-700
        "muted-foreground": "#a1a1aa", // zinc-400
        subtle: "#52525b",           // zinc-600
        border: "#27272a",           // zinc-800
        "border-subtle": "#3f3f46",  // zinc-700

        // Accent
        primary: "#10b981",          // emerald-500
        "primary-hover": "#059669",  // emerald-600
        "primary-foreground": "#ffffff",

        // Semantic
        destructive: "#ef4444",
        warning: "#f59e0b",
        info: "#3b82f6",
        success: "#10b981",

        // Status dot colors (Linear-style)
        "status-pending": "#3b82f6",
        "status-processing": "#f59e0b",
        "status-approved": "#10b981",
        "status-rejected": "#ef4444",
        "status-expired": "#52525b",
      },
    },
  },
  plugins: [],
};
