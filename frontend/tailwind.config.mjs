/** @type {import('tailwindcss').Config} */

// Tailwind is namespaced (`tw-`) and marked important so it coexists with
// Bootstrap without specificity clashes (PATTERN-SPEC §B4.3). Brand palette
// carried over from Drink-X's tailwind.config (§B4.3.1) for visual parity.
export default {
  prefix: 'tw-',
  important: true,
  content: [
    './pages/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
    './core/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        'custom-green': '#0B4321',
        'custom-green-dark': '#262626',
        'custom-green-light': '#7f9a82',
        'custom-orange': '#DD9E54',
        'custom-orange-light': '#E0B58D',
        'backg-color': '#FFFFFF',
        'nav-color': '#FFFCF6',
        'table-color': '#FFFAF0',
      },
      screens: { '8xl': '1440px' },
    },
  },
  plugins: [],
};
