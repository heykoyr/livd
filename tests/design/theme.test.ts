import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  THEME_COLOR,
  THEME_SCRIPT,
  THEME_STORAGE_KEY,
  THEME_VIEWPORT,
  resolveTheme,
} from '@/lib/theme';

/**
 * Who decides the theme.
 *
 * Livd used to open dark for anyone whose OS was dark, because the pre-paint
 * script fell back to `prefers-color-scheme` when nothing was saved. The rule
 * now is that Livd decides the first theme — light — and the visitor decides
 * every one after that. The OS decides nothing.
 *
 * These run the real inline script, the one the browser runs before first
 * paint, against a page whose OS reports dark. They are the tests that would
 * have caught the old behaviour, and would catch it coming back.
 */

/** A browser whose OS prefers `scheme`, as `matchMedia` would report it. */
function osPrefers(scheme: 'light' | 'dark'): ReturnType<typeof vi.fn> {
  const matchMedia = vi.fn((query: string) => ({
    matches: query.includes(`prefers-color-scheme: ${scheme}`),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  return matchMedia;
}

/** Runs the inline script exactly as the document head does. */
function runThemeScript(): void {
  new Function(THEME_SCRIPT)();
}

function shownTheme(): string | null {
  return document.documentElement.getAttribute('data-theme');
}

function chromeColour(): string | null | undefined {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute('content');
}

/** Storage that throws on access, as Safari and Chrome do with site data blocked. */
function blockStorage(): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  // What the server sends: one theme-color, the default theme's.
  document.head.innerHTML = `<meta name="theme-color" content="${THEME_COLOR.light}">`;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the first visit', () => {
  it('is light when the OS is light and nothing is saved', () => {
    osPrefers('light');
    runThemeScript();
    expect(shownTheme()).toBe('light');
  });

  it('is light when the OS is dark and nothing is saved', () => {
    const matchMedia = osPrefers('dark');
    runThemeScript();
    expect(shownTheme()).toBe('light');
    expect(chromeColour()).toBe(THEME_COLOR.light);
    // Not merely outvoted: the OS is never asked.
    expect(matchMedia).not.toHaveBeenCalled();
  });

  it('saves nothing, so "has not chosen" stays distinct from "chose light"', () => {
    osPrefers('dark');
    runThemeScript();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});

describe('a saved choice', () => {
  it('keeps light when the OS is dark', () => {
    osPrefers('dark');
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    runThemeScript();
    expect(shownTheme()).toBe('light');
  });

  it('keeps dark when the OS is light, and paints the browser chrome to match', () => {
    osPrefers('light');
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runThemeScript();
    expect(shownTheme()).toBe('dark');
    expect(chromeColour()).toBe(THEME_COLOR.dark);
  });

  it.each(['system', 'auto', 'Dark', '"dark"', '', 'null'])(
    'is not a choice when it reads %j, and the default applies',
    (saved) => {
      osPrefers('dark');
      localStorage.setItem(THEME_STORAGE_KEY, saved);
      runThemeScript();
      expect(shownTheme()).toBe('light');
    },
  );
});

describe('storage that cannot be used', () => {
  it('falls back to light when reading storage throws', () => {
    osPrefers('dark');
    const restore = blockStorage();
    try {
      expect(runThemeScript).not.toThrow();
      expect(shownTheme()).toBe('light');
    } finally {
      restore();
    }
  });

  it('falls back to light when getItem itself throws', () => {
    osPrefers('dark');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    expect(runThemeScript).not.toThrow();
    expect(shownTheme()).toBe('light');
  });

});

describe('the browser chrome', () => {
  it('corrects every theme-color tag, since a browser reads the first', () => {
    document.head.innerHTML =
      `<meta name="theme-color" content="${THEME_COLOR.light}">` +
      `<meta name="theme-color" content="${THEME_COLOR.light}">`;
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runThemeScript();

    const contents = [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) =>
      meta.getAttribute('content'),
    );
    expect(contents).toEqual([THEME_COLOR.dark, THEME_COLOR.dark]);
  });

  it('still sets the theme when the document has no theme-color', () => {
    document.head.innerHTML = '';
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(runThemeScript).not.toThrow();
    expect(shownTheme()).toBe('dark');
  });
});

describe('the script and the runtime agree', () => {
  // The script is the runtime's decision written out again in ES5, because it
  // must run before any bundle has loaded. This is what keeps the copies equal.
  it.each([null, 'light', 'dark', 'system', '', 'DARK'])('on %j', (saved) => {
    if (saved !== null) localStorage.setItem(THEME_STORAGE_KEY, saved);
    runThemeScript();
    expect(shownTheme()).toBe(resolveTheme(saved));
    expect(chromeColour()).toBe(THEME_COLOR[resolveTheme(saved)]);
  });
});

describe('what the document tells the browser', () => {
  it('declares one theme-color, not a pair keyed on the OS', () => {
    expect(THEME_VIEWPORT.themeColor).toBe(THEME_COLOR.light);
  });

  it('declares only light, so no browser darkens the page by itself', () => {
    expect(THEME_VIEWPORT.colorScheme).toBe('only light');
  });

  const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

  it('derives color-scheme from the theme attribute, both ways', () => {
    const darkAt = CSS.indexOf("[data-theme='dark'] {");
    const darkBlock = CSS.slice(darkAt, CSS.indexOf('}', darkAt));
    expect(darkBlock).toMatch(/color-scheme:\s*dark;/);
    expect(CSS).toMatch(/html\s*{[^}]*color-scheme:\s*only light;/);
  });
});

/* -------------------------------------------------------------------------
 * Nothing else may decide
 * ---------------------------------------------------------------------- */

const SRC = join(process.cwd(), 'src');
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return EXTENSIONS.has(extname(path)) ? [path] : [];
  });
}

/** Comments removed, code kept — the same crude lint as `no-stale-hosts`. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');
}

describe('the OS colour scheme', () => {
  /**
   * Two files are allowed to ask, and both are outside the page.
   *
   * The rule is about Livd's own surface: what the visitor chose beats what
   * their machine prefers, everywhere the product is drawn. Neither of these
   * is drawn there.
   *
   * - `src/app/icon.svg` is the favicon, painted on the browser's tab strip.
   * - `src/server/notify/shell.ts` is an email. There is no visitor to have
   *   chosen anything and no `data-theme` to read — the reader's client is
   *   the only thing that knows which ground the message is on, so asking it
   *   is the only way to send the right one. See docs/brand-mark.md.
   */
  const ALLOWED = ['src/app/icon.svg', 'src/server/notify/shell.ts'];

  it('is read by no code and no stylesheet under src/, bar two that are not the page', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => withoutComments(readFileSync(file, 'utf8')).includes('prefers-color-scheme'))
      .map((file) => relative(process.cwd(), file).replaceAll('\\', '/'))
      .filter((file) => !ALLOWED.includes(file));

    expect(offenders).toEqual([]);
  });

  it('is still read by the email shell, which is the exception being allowed', () => {
    // If this stops being true the exception above is dead wood — remove it
    // rather than leaving a licence nothing uses.
    const shell = readFileSync(join(SRC, 'server/notify/shell.ts'), 'utf8');

    expect(withoutComments(shell)).toContain('prefers-color-scheme');
  });
});

describe('every document Livd renders', () => {
  // A file that renders its own <html> bypasses the root layout, and with it
  // the theme — which is how the 404 came to ignore a saved choice.
  const documents = sourceFiles(join(SRC, 'app'))
    .filter((file) => withoutComments(readFileSync(file, 'utf8')).includes('<html'))
    .map((file) => relative(process.cwd(), file));

  it('includes the root layout and the 404', () => {
    expect(documents.map((f) => f.replaceAll('\\', '/')).sort()).toEqual([
      'src/app/global-not-found.tsx',
      'src/app/layout.tsx',
    ]);
  });

  it.each(documents)('%s applies the saved theme and the shared viewport', (file) => {
    const source = withoutComments(readFileSync(join(process.cwd(), file), 'utf8'));
    expect(source).toContain('<ThemeScript />');
    expect(source).toMatch(/export const viewport: Viewport = THEME_VIEWPORT;/);
  });
});
