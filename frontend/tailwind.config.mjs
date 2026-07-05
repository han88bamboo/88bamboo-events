/** @type {import('tailwindcss').Config} */

// Tailwind is namespaced (`tw-`) and marked important so it coexists with
// Bootstrap without specificity clashes (PATTERN-SPEC §B4.3). The palette + fonts
// mirror the 88bamboo.co Shopify storefront (STYLE-PARITY-PLAN §5) so `tw-*`
// utilities resolve to brand values. The old Drink-X palette (custom-green /
// custom-orange) was replaced during the style-parity work.
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
        // Storefront tokens (see 88BAMBOO-SHOPIFY-STYLE-REFERENCE §1/§4).
        'bamboo-green': '#004f2d', // primary button green
        'bamboo-green-hi': '#009c59', // button hover
        'bamboo-green-header': '#0b4321', // announcement-bar green
        'bamboo-green-link': '#1a6132', // prose link accent
        'bamboo-green-h6': '#03652a',
        'bamboo-slate': '#3d4246', // UI / nav / heading text
        'bamboo-body': '#000000', // article/RTE body copy
        'bamboo-cream': '#f2f0e3', // button label
        'bamboo-yellow': '#fcc200', // reviews bar strip
        'bamboo-border': '#e8e9eb',
        'bamboo-border-form': '#949494',
        'bamboo-footer-bg': '#f5f5f5',
      },
      fontFamily: {
        heading: ['Buenard', 'Georgia', '"Times New Roman"', 'serif'],
        body: ['Georgia', '"Times New Roman"', 'serif'],
      },
      screens: { '8xl': '1440px' },
    },
  },
  plugins: [],
};
