/* Cores e fontes do painel do mestre (carregado logo depois do Tailwind CDN, em todas as páginas). */
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        void: '#0b1118',
        dungeon: {
          950: '#0b1118',
          900: '#141d28',
          800: '#1c2836',
          700: '#354555',
          600: '#54687c',
        },
        amberGold: {
          400: '#d1b77c',
          500: '#c4a86a',
          600: '#d1b77c',
        },
        crimson: {
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
        },
        vigor: {
          400: '#60a5fa',
          500: '#3b82f6',
        },
        sanity: {
          400: '#c084fc',
          500: '#a855f7',
        },
      },
      fontFamily: {
        cinzel: ['Georgia', '"Times New Roman"', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '"Segoe UI"', 'sans-serif'],
      },
    },
  },
};
