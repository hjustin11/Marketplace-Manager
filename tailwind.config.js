/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['DM Sans', 'system-ui', 'sans-serif'], mono: ['Space Mono', 'JetBrains Mono', 'monospace'] },
    },
  },
  plugins: [],
};
