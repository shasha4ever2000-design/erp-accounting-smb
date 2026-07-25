/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Primary accent — a confident, refined blue used sparingly but with intent.
        brand: {
          50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd',
          400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8',
          800: '#1e40af', 900: '#1e3a8a', 950: '#172554',
        },
        // Semantic scales — one voice for state colors across the whole product.
        accent: {
          50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc',
          400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca',
          800: '#3730a3', 900: '#312e81', 950: '#1e1b4b',
        },
        success: {
          50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7',
          400: '#34d399', 500: '#10b981', 600: '#059669', 700: '#047857',
          800: '#065f46', 900: '#064e3b', 950: '#022c22',
        },
        warning: {
          50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d',
          400: '#fbbf24', 500: '#f59e0b', 600: '#d97706', 700: '#b45309',
          800: '#92400e', 900: '#78350f', 950: '#451a03',
        },
        danger: {
          50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5',
          400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c',
          800: '#991b1b', 900: '#7f1d1d', 950: '#450a0a',
        },
        // Refined neutral ramp for dark surfaces — slightly cool, never muddy.
        surface: {
          50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1',
          400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155',
          750: '#293548', 800: '#1e293b', 850: '#172033', 900: '#0f172a',
          925: '#0c1322', 950: '#080d19',
        },
      },
      fontFamily: {
        sans: [
          'Inter', 'IBM Plex Sans Arabic', 'system-ui', '-apple-system',
          'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif',
        ],
      },
      boxShadow: {
        // Layered, low-alpha shadows — depth you feel more than see.
        xs: '0 1px 2px 0 rgb(15 23 42 / 0.05)',
        card: '0 1px 1px 0 rgb(15 23 42 / 0.03), 0 1px 3px 0 rgb(15 23 42 / 0.05), 0 4px 8px -4px rgb(15 23 42 / 0.04)',
        'card-hover': '0 2px 4px -1px rgb(15 23 42 / 0.05), 0 6px 16px -4px rgb(15 23 42 / 0.10), 0 12px 28px -8px rgb(15 23 42 / 0.08)',
        elevated: '0 4px 10px -4px rgb(15 23 42 / 0.10), 0 16px 40px -12px rgb(15 23 42 / 0.24)',
        modal: '0 8px 16px -6px rgb(15 23 42 / 0.12), 0 24px 64px -16px rgb(15 23 42 / 0.32)',
        'btn-primary': 'inset 0 1px 0 0 rgb(255 255 255 / 0.12), 0 1px 2px 0 rgb(29 78 216 / 0.40), 0 2px 6px -1px rgb(37 99 235 / 0.35)',
        'btn-secondary': 'inset 0 1px 0 0 rgb(255 255 255 / 0.6), 0 1px 2px 0 rgb(15 23 42 / 0.06)',
        input: '0 1px 2px 0 rgb(15 23 42 / 0.04)',
        'focus-brand': '0 0 0 4px rgb(59 130 246 / 0.15)',
        glow: '0 0 24px -4px rgb(59 130 246 / 0.35)',
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem', '3xl': '1.5rem' },
      letterSpacing: { snug: '-0.011em', tightest: '-0.03em' },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'scale-in': {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(.97)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          '0%': { opacity: '0', transform: 'translateY(-6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in .2s ease-out',
        'scale-in': 'scale-in .22s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-up': 'slide-up .28s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-down': 'slide-down .18s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slide-in-right .3s cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.8s linear infinite',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
}
