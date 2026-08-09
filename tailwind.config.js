/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f2f7f5',
          100: '#dfeee8',
          500: '#0f7a5c',
          600: '#0c6249',
          700: '#0a4f3b',
        },
      },
    },
  },
  plugins: [],
};
