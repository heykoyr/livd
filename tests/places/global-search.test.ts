import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildSearchHref, parseSearchFilters } from '@/lib/validation/search';

/**
 * Local by default must never become local only.
 *
 * Discovery on `/places` prefers the visitor's own country, which is the one
 * change in this product most likely to quietly turn into a restriction: the
 * moment a resolved country reaches the search path, somebody in Lagos can no
 * longer research a flat in London, and nothing about the interface would say
 * so. A reviewer cannot see that by reading a diff, and no rendered page would
 * look broken.
 *
 * So the rule is enforced structurally. The country resolver is importable by
 * the discovery surfaces and by nothing that constructs a search, and search
 * parsing is held to defaulting worldwide.
 */

const SOURCE_ROOT = join(process.cwd(), 'src');

/** Where a viewer-derived country is legitimately read. */
const DISCOVERY_SURFACES = [
  'app/places/page.tsx',
  'server/geo/viewer-country.ts',
];

function sourceFiles(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) found.push(path);
  }

  return found;
}

function posix(path: string): string {
  return relative(SOURCE_ROOT, path).split(/[\\/]/).join('/');
}

describe('the country resolver reaches only discovery', () => {
  const files = sourceFiles(SOURCE_ROOT);

  it('finds the sources to check', () => {
    expect(files.length).toBeGreaterThan(80);
  });

  it('is imported by the discovery surfaces and nothing else', () => {
    const importers = files
      .filter((file) => /from '@\/server\/geo\/viewer-country'/.test(readFileSync(file, 'utf8')))
      .map(posix);

    expect(importers.sort()).toEqual(
      DISCOVERY_SURFACES.filter((path) => path !== 'server/geo/viewer-country.ts').sort(),
    );
  });

  it('is not reachable from the search page, the suggest endpoint or search parsing', () => {
    // These three are the whole of the search path. A country resolved from a
    // header or a profile must never narrow any of them.
    for (const path of ['app/search/page.tsx', 'app/api/suggest/route.ts', 'lib/validation/search.ts']) {
      const source = readFileSync(join(SOURCE_ROOT, path), 'utf8');
      expect(source, path).not.toMatch(/viewer-country|viewerCountry|edgeCountry/);
      expect(source, path).not.toMatch(/x-vercel-ip-country|cf-ipcountry/);
    }
  });
});

describe('search defaults to worldwide', () => {
  it('is unscoped when no country is asked for', () => {
    expect(parseSearchFilters({ q: 'London' }).countryCode).toBeNull();
    expect(parseSearchFilters({}).countryCode).toBeNull();
  });

  it('scopes only to a country the URL states', () => {
    expect(parseSearchFilters({ q: 'Lagos', country: 'ng' }).countryCode).toBe('NG');
  });

  it('falls back to worldwide rather than guessing at a malformed country', () => {
    for (const country of ['', 'x', 'NGA', '??']) {
      expect(parseSearchFilters({ q: 'Lagos', country }).countryCode, country).toBeNull();
    }
  });

  it('never writes a country into a search URL that was not asked for', () => {
    const filters = parseSearchFilters({ q: 'Toronto' });
    const href = buildSearchHref(filters);

    expect(href).toBe('/search?q=Toronto');
    expect(href).not.toMatch(/country=/);
  });

  it('keeps a country the searcher chose themselves', () => {
    const filters = parseSearchFilters({ q: 'Toronto', country: 'CA' });
    expect(buildSearchHref(filters)).toMatch(/country=CA/);
  });
});
