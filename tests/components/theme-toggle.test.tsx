import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeToggle } from '@/components/layout/theme-toggle';
import { THEME_COLOR, THEME_STORAGE_KEY } from '@/lib/theme';

/**
 * The theme toggle, driven the way a person drives it.
 *
 * The page's theme lives in `data-theme` on `<html>`; the toggle only reads it
 * and changes it. So every assertion here is about the document — what is
 * shown, what is saved, what the browser chrome is told — rather than about
 * the component's own state, which it deliberately does not have.
 */

const root = document.documentElement;

/** The page as the inline script leaves it, before the toggle mounts. */
function pageShowing(theme: 'light' | 'dark'): void {
  root.setAttribute('data-theme', theme);
  document.head.innerHTML = `<meta name="theme-color" content="${THEME_COLOR[theme]}">`;
}

function chromeColour(): string | null | undefined {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute('content');
}

beforeEach(() => {
  localStorage.clear();
  pageShowing('light');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ThemeToggle', () => {
  it('offers dark mode on a light page, and saves nothing until pressed', () => {
    render(<ThemeToggle />);

    const button = screen.getByRole('button', { name: 'Switch to dark mode' });
    // The label names the action, so a pressed state would contradict it.
    expect(button).not.toHaveAttribute('aria-pressed');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(root).toHaveAttribute('data-theme', 'light');
  });

  it('switches to dark at once, remembers it, and repaints the browser chrome', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));

    expect(root).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(chromeColour()).toBe(THEME_COLOR.dark);
    expect(await screen.findByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
  });

  it('switches back to light and saves light as a choice of its own', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    pageShowing('dark');
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));

    expect(root).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(chromeColour()).toBe(THEME_COLOR.light);
    expect(await screen.findByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
  });

  it('works from the keyboard, with Enter and with Space', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.tab();
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(root).toHaveAttribute('data-theme', 'dark');

    await user.keyboard(' ');
    expect(root).toHaveAttribute('data-theme', 'light');
  });

  it('pays no attention to the OS', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-color-scheme: dark'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    render(<ThemeToggle />);

    expect(await screen.findByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
    expect(root).toHaveAttribute('data-theme', 'light');
  });

  it('still switches when storage is blocked, and simply does not remember', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });

    try {
      const user = userEvent.setup();
      render(<ThemeToggle />);
      await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
      expect(root).toHaveAttribute('data-theme', 'dark');
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });

  it('puts the saved theme back if something stripped the attribute', () => {
    // What React's development remount does to `<html>`.
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    root.removeAttribute('data-theme');

    render(<ThemeToggle />);

    expect(root).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
  });

  it('keeps the browser chrome dark when a navigation renders the tag again', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    pageShowing('dark');
    render(<ThemeToggle />);

    // What a client navigation does: Next renders the server's default again,
    // as a new element...
    document.head.innerHTML = `<meta name="theme-color" content="${THEME_COLOR.light}">`;
    await waitFor(() => expect(chromeColour()).toBe(THEME_COLOR.dark));

    // ...or by rewriting the one that is there.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR.light);
    await waitFor(() => expect(chromeColour()).toBe(THEME_COLOR.dark));
  });

  it('follows a choice made in another tab', async () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();

    // Another tab saved dark; this one hears about it through the storage event.
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }));
    });

    expect(root).toHaveAttribute('data-theme', 'dark');
    expect(await screen.findByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
  });
});
