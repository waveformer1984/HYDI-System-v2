/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        colters: {
          primary: '#dc2626',
          secondary: '#7c2d12',
          dark: '#000000',
          gray: '#1f2937'
        }
      }
    },
  },
  plugins: [],
}
