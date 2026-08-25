/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6ff',
          100: '#d9ecff',
          500: '#0b7fda',
          600: '#0969d3',
          700: '#0a54a6',
        },
      },
    },
  },
  plugins: [],
};
