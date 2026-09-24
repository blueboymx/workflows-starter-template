/** @type {import('tailwindcss').Config} */
export default {
	content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
	darkMode: "media", // Automatically follows system preference
	theme: {
		extend: {
			colors: {
				surface: "#ffffff",
				brand: { DEFAULT: "#0061b8", dark: "#004c91" },
			},
		},
	},
	plugins: [],
};
