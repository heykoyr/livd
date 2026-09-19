import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Logo } from '@/components/brand/logo';

/**
 * `<Logo>` follows the site theme without a mechanism of its own.
 *
 * Both files are in the markup and the stylesheet's `dark:` variant — keyed on
 * `data-theme` — decides which one is displayed. jsdom runs no stylesheet, so
 * what is asserted here is the contract with it: which file carries which
 * class, and that nothing a caller passes can break the pairing.
 */

const images = () => screen.getAllByRole('img', { hidden: true }) as HTMLImageElement[];

describe('<Logo>', () => {
  it('renders the official files, the dark-ink one for light and the white one for dark', () => {
    render(<Logo />);
    const [light, dark] = images();

    expect(light).toHaveAttribute('src', '/brand/fitted/livd-logo.svg');
    expect(light).toHaveClass('dark:hidden');
    expect(light).not.toHaveClass('hidden');

    expect(dark).toHaveAttribute('src', '/brand/fitted/livd-logo-white.svg');
    expect(dark).toHaveClass('hidden', 'dark:block');
  });

  it('names Livd, so the logo means something to a screen reader', () => {
    render(<Logo />);
    for (const image of images()) expect(image).toHaveAttribute('alt', 'Livd');
  });

  it('declares the aspect ratio up front, so nothing moves when the file arrives', () => {
    render(<Logo />);
    const [light] = images();
    expect(light).toHaveAttribute('width', '722.657');
    expect(light).toHaveAttribute('height', '211.765');
    expect(light).toHaveClass('h-6', 'w-auto');
  });

  it('renders one file, and no theme switch, when a surface fixes its ground', () => {
    render(<Logo theme="dark" />);
    const [only, ...rest] = images();

    expect(rest).toHaveLength(0);
    expect(only).toHaveAttribute('src', '/brand/fitted/livd-logo-white.svg');
    expect(only).not.toHaveClass('hidden');
    expect(only).not.toHaveClass('dark:hidden');
  });

  it('draws the symbol alone when asked', () => {
    render(<Logo variant="symbol" />);
    expect(images().map((image) => image.getAttribute('src'))).toEqual([
      '/brand/fitted/livd-symbol.svg',
      '/brand/fitted/livd-symbol-white.svg',
    ]);
  });

  it('cannot be made to show both files by a class passed in', () => {
    render(<Logo className="inline-block" />);
    const [light, dark] = images();
    // tailwind-merge keeps the last display utility. The theme classes come
    // after the caller's, so they are the ones that survive.
    expect(dark).toHaveClass('hidden');
    expect(dark).not.toHaveClass('inline-block');
    expect(light).toHaveClass('dark:hidden');
  });
});
