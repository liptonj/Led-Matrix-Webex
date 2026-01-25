'use client';

import { useTheme } from '@/hooks/useTheme';

export function ThemeToggle() {
  const { theme, toggleTheme, mounted } = useTheme();

  // Avoid hydration mismatch by not rendering until mounted
  if (!mounted) {
    return (
      <button
        className="w-10 h-10 rounded-lg border border-white/30 bg-white/10 text-white text-lg cursor-pointer transition-all hover:bg-white/20 flex items-center justify-center"
        aria-label="Toggle theme"
      >
        🌙
      </button>
    );
  }

  return (
    <button
      onClick={toggleTheme}
      className="w-10 h-10 rounded-lg border border-white/30 bg-white/10 text-white text-lg cursor-pointer transition-all hover:bg-white/20 hover:scale-105 focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2 flex items-center justify-center"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      aria-pressed={theme === 'dark'}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      type="button"
    >
      {theme === 'dark' ? '🌙' : '☀️'}
    </button>
  );
}
