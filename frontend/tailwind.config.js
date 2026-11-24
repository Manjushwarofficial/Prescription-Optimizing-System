/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Design system tokens
        surface: {
          base:    '#09090B',  // deep charcoal
          raised:  '#111113',  // card surface
          overlay: '#18181B',  // elevated element
          border:  '#27272A',  // 1px border
        },
        clinical: {
          dark:       '#09090B',
          card:       '#111113',
          border:     '#27272A',
          accent:     '#0ea5e9', // sky-500 — the ONE accent
          critical:   '#ef4444',
          warning:    '#f59e0b',
          safe:       '#10b981',
          suppressed: '#52525b',
        },
      },
      fontFamily: {
        sans:    ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'Fira Code', 'monospace'],
      },
      letterSpacing: {
        tighter: '-0.04em',
        tight:   '-0.025em',
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      animation: {
        'pulse-fast': 'pulse-fast 1.5s cubic-bezier(0.4,0,0.6,1) infinite',
        'shimmer-slide': 'shimmer-slide var(--speed) ease-in-out infinite alternate',
        'spin-around': 'spin-around calc(var(--speed) * 2) infinite linear',
      },
      keyframes: {
        'pulse-fast': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
      },
    },
  },
  plugins: [],
}
