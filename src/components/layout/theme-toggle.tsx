'use client';

import { useEffect, useState } from 'react';

import { IconButton } from '@/components/ui/button';
import { copy } from '@/content/copy';

type Theme = 'light' | 'dark';

/**
 * Theme toggle.
 *
 * The inline script in the document head has already applied the stored theme
 * before paint; this component only reads what it decided and lets the user
 * change it. Rendering nothing until mounted avoids claiming a theme the server
 * could not have known.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'dark' : 'light');
  }, []);

  function toggle(): void {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    document.documentElement.style.colorScheme = next;
    try {
      localStorage.setItem('livd-theme', next);
    } catch {
      // Private browsing, or storage disabled. The theme still applies for this
      // page view; it simply is not remembered.
    }
  }

  if (theme === null) {
    // Reserves the space so the header does not shift when the toggle appears.
    return <div className="size-9" aria-hidden="true" />;
  }

  return (
    <IconButton
      label={copy.nav.theme}
      size="sm"
      onClick={toggle}
      aria-pressed={theme === 'dark'}
      className="text-ink-muted hover:text-ink"
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </IconButton>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3.1" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1.4v1.5M8 13.1v1.5M14.6 8h-1.5M2.9 8H1.4M12.66 3.34l-1.06 1.06M4.4 11.6l-1.06 1.06M12.66 12.66 11.6 11.6M4.4 4.4 3.34 3.34"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
      <path
        d="M13.5 9.6A5.9 5.9 0 0 1 6.4 2.5a5.9 5.9 0 1 0 7.1 7.1Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
