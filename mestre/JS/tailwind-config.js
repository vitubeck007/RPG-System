/* Cores e fontes do painel do mestre (carregado logo depois do Tailwind CDN, em todas as páginas). */
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        void: '#090b10',
        dungeon: {
          950: '#0c0f16',
          900: '#111622',
          800: '#182030',
          700: '#232d42',
          600: '#32405d',
        },
        amberGold: {
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
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
        cinzel: ['"Cinzel"', 'serif'],
        sans: ['"Inter"', 'sans-serif'],
      },
    },
  },
};
