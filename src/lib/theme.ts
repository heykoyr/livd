import type { Viewport } from 'next';

/**
 * Which theme Livd shows, and who decides.
 *
 * Livd decides the first one; the visitor decides every one after that; the
 * operating system decides none of them. Someone who has never pressed the
 * toggle sees the light theme even if their OS and browser prefer dark, and
 * someone who has chosen keeps their choice when their OS later changes.
 * Nothing in this module reads `prefers-color-scheme`, and nothing anywhere
 * else may — `tests/design/theme.test.ts` fails if any code or CSS under
 * `src/` uses it.
 *
 * `data-theme` on `<html>` is the one place the current theme lives. The
 * stylesheet derives every colour token and the `color-scheme` from it, the
 * toggle reads it, and only two things ever write it: `THEME_SCRIPT`, before
 * first paint, and `applyTheme`, when the visitor chooses.
 */

export type Theme = 'light' | 'dark';

/**
 * The one key a choice is saved under. Visitors who chose a theme before the
 * default stopped following the OS chose it here, so renaming this would
 * quietly throw their choice away.
 */
export const THEME_STORAGE_KEY = 'livd-theme';

/** What a visitor sees until they choose. */
export const DEFAULT_THEME: Theme = 'light';

/**
 * Each theme's canvas token, for the browser's own chrome — Android's address
 * bar, Safari's tab bar — so it matches the page rather than the OS.
 */
export const THEME_COLOR: Record<Theme, string> = {
  light: '#fbfaf8',
  dark: '#0d0e0d',
};

/**
 * A saved value, read as the theme it means.
 *
 * Only an explicit `light` or `dark` is a choice. Anything else — nothing
 * saved, storage that cannot be read, a value some later version might write —
 * means no choice has been made, and the answer is the default rather than a
 * guess.
 */
export function resolveTheme(saved: string | null | undefined): Theme {
  return saved === 'light' || saved === 'dark' ? saved : DEFAULT_THEME;
}

/**
 * Applies the saved theme before first paint.
 *
 * Rendered inline at the end of `<head>` by `ThemeScript`. It runs while the
 * document is still being parsed: after the stylesheet has loaded, which a
 * parser-blocking script waits for, and before anything has been drawn.
 * Deciding in React instead would paint the default and then flip it.
 *
 * It is `applyTheme(resolveTheme(readSavedTheme()))` written out again in ES5,
 * because it has to run before any bundle exists; the tests run it against the
 * same cases so the two cannot drift. It saves nothing — a first visit leaves
 * storage empty, so "has not chosen" stays distinguishable from "chose light".
 *
 * The CSP permits it as it permitted its predecessor: `script-src` carries
 * `'unsafe-inline'` for Next's own bootstrap scripts. Every value interpolated
 * below is a constant from this file, never input.
 */
export const THEME_SCRIPT = `
(function () {
  var theme = ${JSON.stringify(DEFAULT_THEME)};
  try {
    var saved = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch (e) {}
  document.documentElement.setAttribute('data-theme', theme);
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) {
    metas[i].setAttribute('content', ${JSON.stringify(THEME_COLOR)}[theme]);
  }
})();
`.trim();

/**
 * The viewport fields that concern the theme, shared by both documents Livd
 * renders: the root layout, and the 404 page, which owns its own `<html>`.
 *
 * `themeColor` is one colour, not a light/dark pair keyed on the OS — a pair
 * would paint the browser chrome by the OS while the page follows Livd. It
 * starts as the default theme's, and the script above corrects it before
 * paint for anyone who chose dark.
 *
 * `colorScheme` says the page is light unless the stylesheet says otherwise,
 * which it does only under `[data-theme='dark']`. `only` matters: without it, a
 * browser set to darken websites automatically (Chrome on Android offers this)
 * would invert the light theme for anyone whose OS is dark — the OS deciding
 * after all, and with a filter rather than the designed dark palette.
 */
export const THEME_VIEWPORT = {
  themeColor: THEME_COLOR[DEFAULT_THEME],
  colorScheme: 'only light',
} as const satisfies Viewport;

/* -------------------------------------------------------------------------
 * In the browser
 *
 * Everything below touches `document` or `localStorage`, so it may only be
 * called from an event handler or an effect.
 * ---------------------------------------------------------------------- */

/** The theme the page is showing now, read from the one place it lives. */
export function currentTheme(): Theme {
  return resolveTheme(document.documentElement.getAttribute('data-theme'));
}

/**
 * Every `theme-color` tag, not just the first. There should be one, but the
 * 404 document picks up a second copy of its metadata after hydration in
 * development; a browser reads the first, so correcting all of them means it
 * never matters which.
 */
function themeColorTags(): NodeListOf<HTMLMetaElement> {
  return document.querySelectorAll('meta[name="theme-color"]');
}

/** Shows `theme`: the attribute the stylesheet keys on, and the chrome to match. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  for (const meta of themeColorTags()) meta.setAttribute('content', THEME_COLOR[theme]);
}

/** The saved value as stored, or null when there is none or storage is blocked. */
export function readSavedTheme(): string | null {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Remembers an explicit choice. Only the toggle calls this. */
export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private browsing, or storage disabled. The theme still applies for the
    // rest of this visit; it simply is not remembered.
  }
}

/**
 * Keeps the browser chrome on the shown theme.
 *
 * Next renders the viewport's `theme-color` again on client navigation, and
 * what it renders is the server's default, since the server cannot know the
 * visitor chose dark. Left alone, a phone's address bar turned light on the
 * first link followed while the page stayed dark. This puts the right colour
 * back whenever the tag changes; an observer's callback runs before the
 * browser paints, so the wrong one is never shown.
 */
export function keepThemeColorInStep(): () => void {
  function correct(): void {
    const wanted = THEME_COLOR[currentTheme()];
    for (const meta of themeColorTags()) {
      // Only on a difference: rewriting an equal value is itself a mutation,
      // and would call this again for ever.
      if (meta.getAttribute('content') !== wanted) meta.setAttribute('content', wanted);
    }
  }

  const observer = new MutationObserver(correct);
  observer.observe(document.head, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['content'],
  });
  correct();
  return () => observer.disconnect();
}

/**
 * Calls `onChange` whenever the shown theme changes, whatever changed it — the
 * toggle, a choice made in another tab, or the re-application after a
 * development remount. Shaped for `useSyncExternalStore`.
 */
export function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => observer.disconnect();
}
