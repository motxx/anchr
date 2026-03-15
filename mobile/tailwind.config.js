/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: "#10b981",
        "primary-foreground": "#ffffff",
        background: "#f5f5f4",
        foreground: "#1c1917",
        card: "#ffffff",
        "card-foreground": "#1c1917",
        muted: "#e7e5e4",
        "muted-foreground": "#78716c",
        border: "#d6d3d1",
        destructive: "#ef4444",
      },
    },
  },
  plugins: [],
};
