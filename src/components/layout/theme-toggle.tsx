'use client';

import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';

import { IconButton } from '@/components/ui/button';
import { copy } from '@/content/copy';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  currentTheme,
  keepThemeColorInStep,
  readSavedTheme,
  resolveTheme,
  saveTheme,
  subscribeToTheme,
} from '@/lib/theme';

/**
 * Theme toggle.
 *
 * The inline script in the document head has already applied the saved theme
 * before paint; this component reads what it decided and lets the visitor
 * change it. It keeps no copy of the theme in state — a copy is a second
 * source of truth that can disagree — so its icon and label follow
 * `data-theme` whoever changes it. Rendering nothing until hydrated avoids
 * claiming a theme the server could not have known.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToTheme, currentTheme, () => null);

  // Strict Mode remounts the document in development, and React drops the
  // attributes on `<html>` it did not set itself — `data-theme` among them.
  // Putting the saved theme back before paint keeps development honest; in
  // production it sets what the script already set.
  useLayoutEffect(() => {
    applyTheme(resolveTheme(readSavedTheme()));
  }, []);

  // A choice made in another tab applies here too, rather than this tab
  // disagreeing until it is next reloaded. A null key means storage was
  // cleared outright.
  useEffect(() => {
    function handleStorage(event: StorageEvent): void {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      applyTheme(resolveTheme(readSavedTheme()));
    }

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // The header outlives every navigation, so this is the component that can
  // keep the browser chrome right across them.
  useEffect(() => keepThemeColorInStep(), []);

  function toggle(): void {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    saveTheme(next);
  }

  if (theme === null) {
    // Reserves the space so the header does not shift when the toggle appears.
    return <div className="size-9" aria-hidden="true" />;
  }

  return (
    <IconButton
      // Names what a press does rather than what is on, so nobody has to work
      // out which way it goes. A label that changes is also why this is not
      // `aria-pressed`, which would have to describe a fixed one.
      label={theme === 'dark' ? copy.nav.themeToLight : copy.nav.themeToDark}
      size="sm"
      onClick={toggle}
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
