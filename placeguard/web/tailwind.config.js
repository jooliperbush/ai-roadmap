/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "var(--surface)",
        raised: "var(--surface-raised)",
        line: "var(--line)",
        ink: "var(--text-primary)",
        muted: "var(--text-secondary)",
        accent: "var(--accent)",
        good: "var(--status-good)",
        critical: "var(--status-critical)",
        warning: "var(--status-warning)",
      },
    },
  },
  plugins: [],
};
