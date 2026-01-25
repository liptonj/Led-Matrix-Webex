'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Theme } from '@/types';

const STORAGE_KEY = 'led_matrix_theme';

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);

  // Get preferred theme from localStorage or system preference
  const getPreferredTheme = useCallback((): Theme => {
    if (typeof window === 'undefined') return 'dark';
    
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }

    // Check system preference
    if (window.matchMedia?.('(prefers-color-scheme: light)').matches) {
      return 'light';
    }

    // Default to dark (Webex theme)
    return 'dark';
  }, []);

  // Apply theme to document
  const applyTheme = useCallback((newTheme: Theme) => {
    if (typeof document === 'undefined') return;
    
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(newTheme);
  }, []);

  // Toggle between light and dark theme
  const toggleTheme = useCallback(() => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, newTheme);
    setThemeState(newTheme);
    applyTheme(newTheme);
  }, [theme, applyTheme]);

  // Set specific theme
  const setTheme = useCallback((newTheme: Theme) => {
    localStorage.setItem(STORAGE_KEY, newTheme);
    setThemeState(newTheme);
    applyTheme(newTheme);
  }, [applyTheme]);

  // Initialize theme on mount
  useEffect(() => {
    const preferred = getPreferredTheme();
    setThemeState(preferred);
    applyTheme(preferred);
    setMounted(true);
  }, [getPreferredTheme, applyTheme]);

  // Listen for system theme changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      // Only follow system if user hasn't set a preference
      if (!localStorage.getItem(STORAGE_KEY)) {
        const newTheme = e.matches ? 'dark' : 'light';
        setThemeState(newTheme);
        applyTheme(newTheme);
      }
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [applyTheme]);

  return {
    theme,
    setTheme,
    toggleTheme,
    mounted,
    isDark: theme === 'dark',
    isLight: theme === 'light',
  };
}
