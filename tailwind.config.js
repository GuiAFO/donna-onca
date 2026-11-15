/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Identidade Donna Onça — feminina, clara e profissional
        creme: '#FBF7F4',      // fundo off-white
        rose: {
          DEFAULT: '#C98A94',  // rosé/blush primário
          soft: '#E7C3C8',     // rosé claro (chips, bordas)
          deep: '#A86670',     // rosé escuro (hover/ativo)
        },
        grafite: '#2E2A28',    // texto principal
        tawny: '#C8954A',      // âmbar/dourado — acento "onça", só detalhes
      },
      fontFamily: {
        marca: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        xl2: '1.25rem',
      },
      boxShadow: {
        card: '0 2px 16px rgba(46, 42, 40, 0.06)',
      },
    },
  },
  plugins: [],
}
