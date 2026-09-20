import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import NotFound from '@/app/not-found';
import { copy } from '@/content/copy';

/**
 * The 404 Livd draws itself.
 *
 * Until `app/not-found.tsx` existed, a route that called `notFound()` — a
 * country code that is not one, a claim page for a property that is gone —
 * showed the framework's own "404 | This page could not be found." in the
 * system font, between Livd's real header and footer. It read as a broken
 * page rather than a record that is not there, and it carried an unlayered
 * stylesheet that coloured the body by the operating system's scheme,
 * overriding the theme the visitor had chosen.
 *
 * Both faults come back the moment that file stops existing, and neither is
 * visible in a diff that removes it, so they are asserted here.
 */

// The search box routes on submit; nothing here presses it.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
}));

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('the 404 inside the site chrome', () => {
  it('names what was not found', () => {
    render(<NotFound />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      copy.errors.notFoundTitle,
    );
    expect(screen.getByText(copy.errors.notFoundBody)).toBeInTheDocument();
  });

  it('offers the search box, which is the way back from a stale link', () => {
    render(<NotFound />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('offers the two ways out', () => {
    render(<NotFound />);

    expect(screen.getByRole('link', { name: copy.nav.explore })).toHaveAttribute(
      'href',
      '/places',
    );
    expect(screen.getByRole('link', { name: copy.errors.notFoundHome })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('says nothing the framework would have said', () => {
    const { container } = render(<NotFound />);
    expect(container.textContent).not.toContain('This page could not be found');
  });
});

describe('the framework never draws a 404', () => {
  it('keeps a root not-found.tsx, or the built-in one takes the page back', () => {
    expect(read('src/app/not-found.tsx')).toContain('<PageNotFound />');
  });

  it('says the same thing as the 404 that owns its own document', () => {
    // Two surfaces, one message: `global-not-found.tsx` answers a URL that
    // matched no route, this one answers a route that found nothing.
    expect(read('src/app/global-not-found.tsx')).toContain('<PageNotFound />');
  });

  it('no longer needs the stylesheet override the built-in forced', () => {
    // Removed with the built-in it defended against. If the framework's 404
    // becomes reachable again, this is the other half that has to come back.
    expect(read('src/app/globals.css')).not.toContain('next-error-h1');
  });
});
