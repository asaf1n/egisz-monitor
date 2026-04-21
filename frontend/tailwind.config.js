/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f4efe6",
        ink: "#122117",
        moss: "#36543b",
        clay: "#b25f3f",
        wheat: "#ead7b7",
        mist: "#f8f6f1"
      },
      boxShadow: {
        card: "0 20px 45px rgba(18, 33, 23, 0.12)"
      },
      backgroundImage: {
        "dashboard-grid":
          "linear-gradient(rgba(18, 33, 23, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(18, 33, 23, 0.05) 1px, transparent 1px)"
      }
    }
  },
  plugins: []
};
