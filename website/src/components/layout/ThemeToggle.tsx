'use client';

import { useTheme } from '@/hooks/useTheme';

export function ThemeToggle() {
  const { theme, toggleTheme, mounted } = useTheme();

  // Avoid hydration mismatch by not rendering until mounted
  if (!mounted) {
    return (
      <button
        className="px-4 py-2 rounded-full border border-white/45 bg-white/20 text-white text-sm cursor-pointer transition-all hover:bg-white/30"
        aria-label="Toggle theme"
      >
        Theme: Dark
      </button>
    );
  }

  return (
    <button
      onClick={toggleTheme}
      className="px-4 py-2 rounded-full border border-white/45 bg-white/20 text-white text-sm cursor-pointer transition-all hover:bg-white/30 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2"
      aria-pressed={theme === 'dark'}
      type="button"
    >
      Theme: {theme === 'dark' ? 'Dark' : 'Light'}
    </button>
  );
}
