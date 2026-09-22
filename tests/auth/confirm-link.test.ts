import { describe, expect, it } from 'vitest';

import { destinationFromLink, parseEmailLinkParams } from '@/lib/auth/confirm-link';

/**
 * Reading what a sign-in email carries.
 *
 * `next` arrives as `{{ .RedirectTo }}` — the absolute address Livd gave
 * Supabase — and whether Supabase's template renderer percent-encodes it is
 * not something a unit test can know. So both forms are tested, and so is
 * every way the value could try to leave the site.
 */

const ORIGINS = ['https://livd.site', 'https://www.livd.site'];

// A real token hash's shape: `pkce_` and a hex SHA-224.
const HASH = `pkce_${'a1b2c3d4'.repeat(7)}`;

describe('the token', () => {
  it('accepts a PKCE token hash and a plain one', () => {
    expect(parseEmailLinkParams({ token_hash: HASH, type: 'email' })).toEqual({
      tokenHash: HASH,
      type: 'email',
    });
    expect(parseEmailLinkParams({ token_hash: HASH.slice(5), type: 'magiclink' })?.type).toBe(
      'magiclink',
    );
  });

  it('defaults a missing type to email, which covers first and later sign-ins', () => {
    expect(parseEmailLinkParams({ token_hash: HASH })?.type).toBe('email');
  });

  it.each([
    ['nothing', undefined],
    ['too short', 'abc'],
    ['a payload', `${HASH}"><script>`],
    ['whitespace inside', 'pkce_abc def0123456789'],
    ['far too long', 'a'.repeat(200)],
  ])('refuses %s', (_label, token_hash) => {
    expect(parseEmailLinkParams({ token_hash, type: 'email' })).toBeNull();
  });

  it.each(['recovery', 'invite', 'email_change', 'sms'])(
    'refuses the %s type, which Livd never sends',
    (type) => {
      expect(parseEmailLinkParams({ token_hash: HASH, type })).toBeNull();
    },
  );
});

describe('where it lands', () => {
  it('unwraps the destination from the callback address Livd asked for', () => {
    // What arrives when the renderer leaves the value alone…
    expect(
      destinationFromLink('https://livd.site/auth/callback?next=/review', ORIGINS),
    ).toBe('/review');
    // …and when it percent-encodes it, once decoded by the query parser.
    expect(
      destinationFromLink('https://livd.site/auth/callback?next=%2Fproperty%2Fthe-franklin', ORIGINS),
    ).toBe('/property/the-franklin');
  });

  it('keeps a query string it was given intact', () => {
    expect(
      destinationFromLink(
        `https://livd.site/auth/callback?next=${encodeURIComponent('/search?q=lagos&country=NG')}`,
        ORIGINS,
      ),
    ).toBe('/search?q=lagos&country=NG');
  });

  it('takes the path of any other Livd address', () => {
    expect(destinationFromLink('https://www.livd.site/shortlist', ORIGINS)).toBe('/shortlist');
    expect(destinationFromLink('/account', ORIGINS)).toBe('/account');
  });

  it('falls back to the home page for the Site URL itself', () => {
    // What Supabase substitutes when a redirect is not on its allow list.
    expect(destinationFromLink('https://livd.site', ORIGINS)).toBe('/');
  });

  it.each([
    ['another host', 'https://evil.example/review'],
    ['another host wrapping a callback', 'https://evil.example/auth/callback?next=/review'],
    ['a look-alike', 'https://livd.site.evil.example/review'],
    ['localhost', 'http://localhost:3000/review'],
    ['a protocol-relative next', 'https://livd.site/auth/callback?next=//evil.example'],
    ['an absolute next', 'https://livd.site/auth/callback?next=https://evil.example'],
    ['a backslash next', 'https://livd.site/auth/callback?next=/%5Cevil.example'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['garbage', 'not a url at all'],
  ])('never leaves the site for %s', (_label, raw) => {
    expect(destinationFromLink(raw, ORIGINS)).toBe('/');
  });

  it('never sends someone back into the sign-in flow', () => {
    expect(destinationFromLink('https://livd.site/auth/callback?next=/auth/verify', ORIGINS)).toBe('/');
    expect(destinationFromLink('https://livd.site/sign-in', ORIGINS)).toBe('/');
  });
});
