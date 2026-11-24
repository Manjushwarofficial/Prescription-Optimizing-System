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
        surface: {
          base:    '#0B1120',  // Deep rich midnight slate
          raised:  '#111C35',  // Elevated card surface
          card:    '#131F38',  // Rich card background
          overlay: '#1A2949',  // Top interactive layer
          border:  '#253556',  // Crisp high-contrast border
        },
        clinical: {
          navy:       '#0B1120',
          card:       '#131F38',
          border:     '#253556',
          accent:     '#0284C7', // Sky-600 primary
          sky:        '#38BDF8', // High-visibility bright sky
          critical:   '#F43F5E', // Vivid crimson
          warning:    '#F59E0B', // Bright amber
          safe:       '#10B981', // Vivid emerald
          purple:     '#818CF8', // Indigo/violet
          suppressed: '#94A3B8', // High contrast silver text
        },
      },
      fontFamily: {
        sans:    ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'Fira Code', 'monospace'],
      },
      letterSpacing: {
        tighter: '-0.04em',
        tight:   '-0.025em',
      },
      boxShadow: {
        'glow-sky':     '0 0 20px -3px rgba(56, 189, 248, 0.25)',
        'glow-emerald': '0 0 20px -3px rgba(16, 185, 129, 0.25)',
        'glow-rose':    '0 0 20px -3px rgba(244, 63, 94, 0.25)',
      },
    },
  },
  plugins: [],
}
