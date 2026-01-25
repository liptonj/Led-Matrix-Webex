import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#00bceb',
          dark: '#0097c1',
          light: '#33c9ef',
        },
        success: '#6cc04a',
        warning: '#ffcc00',
        danger: '#ff5c5c',
        purple: '#9b59b6',
        status: {
          active: '#6cc04a',
          meeting: '#ff5c5c',
          dnd: '#ff5c5c',
          away: '#ffcc00',
          ooo: '#9b59b6',
          offline: '#8892a0',
        },
        dark: {
          bg: '#1a1a2e',
          card: '#16213e',
          hover: '#1f3460',
          border: '#2d3a4f',
          surface: '#16213e',
          'surface-alt': '#1f3460',
        },
        light: {
          bg: '#f4f6f8',
          card: '#ffffff',
          hover: '#e8edf2',
          border: '#dee2e6',
          surface: '#ffffff',
          'surface-alt': '#f8f9fa',
        },
        text: {
          primary: 'var(--color-text)',
          muted: 'var(--color-text-muted)',
          secondary: 'var(--color-text-secondary)',
        },
        code: {
          bg: '#0e1116',
          text: '#e6e8eb',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Oxygen',
          'Ubuntu',
          'sans-serif',
        ],
        mono: ['SF Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      boxShadow: {
        sm: '0 1px 3px rgba(0, 0, 0, 0.3)',
        md: '0 2px 8px rgba(0, 0, 0, 0.3)',
        lg: '0 4px 16px rgba(0, 0, 0, 0.4)',
        elevated: '0 2px 12px rgba(0, 0, 0, 0.4)',
      },
      borderRadius: {
        DEFAULT: '8px',
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease',
        'slide-in-left': 'slideInLeft 0.3s ease',
        'slide-in-up': 'slideInUp 0.3s ease',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideInLeft: {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        slideInUp: {
          from: { transform: 'translateY(20px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
      },
      zIndex: {
        dropdown: '100',
        sticky: '200',
        fixed: '300',
        'modal-backdrop': '400',
        modal: '500',
        popover: '600',
        tooltip: '700',
      },
    },
  },
  plugins: [],
}
export default config
