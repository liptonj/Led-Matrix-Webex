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
        // Primary colors reference CSS variables
        primary: {
          DEFAULT: 'var(--color-primary)',
          dark: 'var(--color-primary-dark)',
          light: 'var(--color-primary-light)',
        },
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        danger: 'var(--color-danger)',
        purple: 'var(--color-purple)',
        
        // Status colors reference CSS variables
        status: {
          active: 'var(--color-active)',
          meeting: 'var(--color-meeting)',
          dnd: 'var(--color-dnd)',
          away: 'var(--color-away)',
          ooo: 'var(--color-ooo)',
          offline: 'var(--color-offline)',
        },
        
        // Note: gray, green, red, yellow use Tailwind defaults
        // This allows dark: variants to work correctly (e.g., bg-gray-50 dark:bg-gray-900)
        
        // Base theme colors
        text: {
          primary: 'var(--color-text)',
          muted: 'var(--color-text-muted)',
          secondary: 'var(--color-text-secondary)',
        },
        bg: {
          DEFAULT: 'var(--color-bg)',
          card: 'var(--color-bg-card)',
          hover: 'var(--color-bg-hover)',
        },
        surface: {
          DEFAULT: 'var(--color-surface)',
          alt: 'var(--color-surface-alt)',
        },
        border: 'var(--color-border)',
        code: {
          bg: 'var(--color-code-bg)',
          text: 'var(--color-code-text)',
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
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        elevated: 'var(--shadow-elevated)',
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
