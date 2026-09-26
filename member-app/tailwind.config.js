/** Challenge Gym brand — lime on charcoal (reference designs), Lexend + Inter (existing app). */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        lime: { DEFAULT: '#C8F135', 50: '#F7FDE3', 100: '#EEFBC4', 200: '#E0F78F', 300: '#D4F45E', 400: '#C8F135', 500: '#B2DB1F', 600: '#8BAF12', 700: '#678310', 800: '#4D6112', 900: '#3B4A12' },
        ink: { DEFAULT: '#0E0F11', 900: '#0E0F11', 850: '#131417', 800: '#17191C', 700: '#1F2226', 600: '#2A2E33', 500: '#3A3F45', 400: '#5D6268', 300: '#9BA1A6', 200: '#C9CDD0', 100: '#E8EAEB' },
        paper: { DEFAULT: '#F4F5F0', card: '#FFFFFF', line: '#E3E5DE' },
        // semantic, readable on both themes
        ok: '#22C55E', warn: '#F5A524', bad: '#F0524F', info: '#4DA3FF',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Lexend', 'Inter', 'sans-serif'],
      },
      borderRadius: { '4xl': '2rem' },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,.04), 0 8px 24px -12px rgba(0,0,0,.12)',
        lime: '0 8px 24px -8px rgba(200,241,53,.55)',
      },
    },
  },
  plugins: [],
};
