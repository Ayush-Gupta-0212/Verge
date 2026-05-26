import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:        '#0a0807',
        'bg-deep': '#050403',
        ink:       '#f0ebe4',
        'ink-mute': 'rgba(240, 235, 228, 0.62)',
        'ink-faint': 'rgba(240, 235, 228, 0.38)',
        // Amber palette resolves through CSS vars so the user's chosen
        // accent (amber / violet / aurora) flows through every Tailwind
        // class that uses `amber` without touching individual call sites.
        amber: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          soft:    'rgb(var(--accent-soft-rgb) / <alpha-value>)',
          deep:    'rgb(var(--accent-deep-rgb) / <alpha-value>)',
          glow:    'rgb(var(--accent-rgb) / 0.18)',
        },
        lunar:     '#b8d4e3',
        line:      'rgb(var(--accent-rgb) / 0.10)',
      },
      fontFamily: {
        sans:    ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
        display: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
        mono:    ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        xl: '14px',
        '2xl': '20px',
        '3xl': '28px',
      },
      animation: {
        breathe: 'breathe 5s ease-in-out infinite',
        'pulse-soft': 'pulse-soft 3s ease-in-out infinite',
        'fade-in': 'fade-in 600ms ease-out',
      },
      keyframes: {
        breathe: {
          '0%,100%': { opacity: '0.9', transform: 'scale(1)' },
          '50%':     { opacity: '1',   transform: 'scale(1.03)' },
        },
        'pulse-soft': {
          '0%,100%': { opacity: '0.55' },
          '50%':     { opacity: '1' },
        },
        'fade-in': {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
