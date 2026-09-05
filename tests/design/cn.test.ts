import { describe, expect, it } from 'vitest';

import { buttonClasses } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Regression tests for class merging.
 *
 * These exist because of a real bug: tailwind-merge did not know Livd's custom
 * `--text-*` scale, so it read `text-body` as a *colour* and silently dropped
 * the `text-canvas` that gave every primary button its foreground. In dark mode
 * the result was a light label on a light button — a 1.1:1 contrast failure on
 * the most prominent control in the product, invisible in code review and
 * invisible in light mode.
 *
 * A design system built on a token scale the merge utility has not been told
 * about will keep producing this failure in new places, so it is pinned here.
 */
describe('cn', () => {
  it('keeps a text colour alongside a custom font size', () => {
    const result = cn('bg-brand text-canvas', 'text-body');
    expect(result).toContain('text-canvas');
    expect(result).toContain('text-body');
  });

  it('keeps a text colour alongside every size in the scale', () => {
    const sizes = [
      'text-micro',
      'text-label',
      'text-body',
      'text-body-lg',
      'text-title-md',
      'text-title-lg',
      'text-display-md',
      'text-display-lg',
      'text-display-xl',
    ];

    for (const size of sizes) {
      const result = cn('text-ink', size);
      expect(result, `${size} dropped the text colour`).toContain('text-ink');
      expect(result, `${size} was itself dropped`).toContain(size);
    }
  });

  it('still resolves genuine conflicts', () => {
    expect(cn('text-ink', 'text-canvas')).toBe('text-canvas');
    expect(cn('text-body', 'text-label')).toBe('text-label');
    expect(cn('bg-brand', 'bg-surface')).toBe('bg-surface');
    expect(cn('duration-fast', 'duration-slow')).toBe('duration-slow');
  });

  it('lets a caller override a component default', () => {
    expect(cn('rounded-md p-4', 'rounded-lg')).toBe('p-4 rounded-lg');
  });
});

describe('buttonClasses', () => {
  it('gives every variant both a background and a foreground', () => {
    const variants = ['primary', 'secondary', 'ghost', 'danger', 'quiet'] as const;

    for (const variant of variants) {
      const result = buttonClasses(variant, 'md');

      // `ghost` is transparent by design; every other variant must paint a
      // background, and all of them must set a foreground rather than
      // inheriting one that may not contrast with it.
      if (variant !== 'ghost') {
        expect(result, `${variant} has no background`).toMatch(/\bbg-[a-z]/);
      }
      expect(result, `${variant} has no foreground`).toMatch(/\btext-[a-z]/);
    }
  });

  it('does not lose the foreground when a size is applied', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      expect(buttonClasses('primary', size)).toContain('text-canvas');
    }
  });

  it('does not lose the foreground when a caller passes extra classes', () => {
    expect(buttonClasses('primary', 'sm', 'hidden sm:inline-flex')).toContain('text-canvas');
    expect(buttonClasses('primary', 'lg', 'w-full')).toContain('text-canvas');
  });
});
