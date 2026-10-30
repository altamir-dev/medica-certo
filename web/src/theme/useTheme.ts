import { useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | null;

const STORAGE_KEY = 'mc-theme';

function readStored(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    /* ignore */
  }
  return null;
}

function applyTheme(theme: ThemePreference) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

export function useTheme(): [ThemePreference, () => void] {
  const [theme, setTheme] = useState<ThemePreference>(() => readStored());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = () => {
    const prefersDark = window.matchMedia?.(
      '(prefers-color-scheme: dark)',
    ).matches;
    const current = theme ?? (prefersDark ? 'dark' : 'light');
    const next: ThemePreference = current === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  };

  return [theme, toggle];
}
