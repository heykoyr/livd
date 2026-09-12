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

/**
 * Where a viewer-derived country is legitimately read.
 *
 * The search page is on this list deliberately. It resolves a country and
 * passes it as `SearchRanking.preferCountryCode`, which may reorder equally
 * relevant matches and may never change which matches there are. The rules
 * below hold it to that; `tests/search/global-reach.test.ts` proves the
 * behaviour against the adapters.
 */
const DISCOVERY_SURFACES = [
  'app/places/page.tsx',
  'app/search/page.tsx',
  // Scopes the count of properties Livd cannot place, so an empty proximity
  // result can say whether the area is empty or Livd's data is. It reads the
  // coarse header only — never a session — and the country never reaches the
  // proximity query itself, which takes a position and a radius.
  'server/actions/property-verification.ts',
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

describe('the country resolver reaches only where it may', () => {
  const files = sourceFiles(SOURCE_ROOT);

  it('finds the sources to check', () => {
    expect(files.length).toBeGreaterThan(80);
  });

  it('is imported only by the surfaces allowed to read it', () => {
    const importers = files
      .filter((file) => /from '@\/server\/geo\/viewer-country'/.test(readFileSync(file, 'utf8')))
      .map(posix);

    expect(importers.sort()).toEqual(
      DISCOVERY_SURFACES.filter((path) => path !== 'server/geo/viewer-country.ts').sort(),
    );
  });

  it('is not reachable from search parsing or the suggest endpoint', () => {
    // These two decide which properties a query matches at all. A country
    // resolved from a header or a profile must never narrow either of them.
    for (const path of ['lib/validation/search.ts', 'app/api/suggest/route.ts']) {
      const source = readFileSync(join(SOURCE_ROOT, path), 'utf8');
      expect(source, path).not.toMatch(/viewer-country|viewerCountry|edgeCountry/);
      expect(source, path).not.toMatch(/x-vercel-ip-country|cf-ipcountry/);
    }
  });

  it('reaches the search page only as a ranking preference', () => {
    const source = readFileSync(join(SOURCE_ROOT, 'app', 'search', 'page.tsx'), 'utf8');

    // It must arrive as a preference...
    expect(source).toMatch(/preferCountryCode/);

    // ...and never be assigned into the filter shape, which is the one line
    // that would turn a local default into a geographic restriction.
    expect(source).not.toMatch(/countryCode:\s*preferCountryCode/);
    expect(source).not.toMatch(/countryCode:\s*await\s+viewerCountry/);
  });

  it('never lets a resolved country reach the search RPC as a filter', () => {
    // `filter_country` decides which properties exist for a query. Only the
    // searcher's own filter may set it.
    const adapter = readFileSync(
      join(SOURCE_ROOT, 'server', 'data', 'supabase', 'index.ts'),
      'utf8',
    );

    expect(adapter).toMatch(/filter_country:\s*filters\.countryCode\s*\?\?\s*null/);
    expect(adapter).not.toMatch(/filter_country:\s*[^,]*prefer/i);
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
