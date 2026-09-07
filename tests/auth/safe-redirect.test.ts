import { describe, expect, it } from 'vitest';

import { DEFAULT_SIGNED_IN_PATH, safeNextPath } from '@/lib/auth/safe-redirect';

/**
 * Where a sign-in is allowed to send you afterwards.
 *
 * The magic-link flow carries a destination out through an email and back
 * again, which is the exact shape of an open redirect: a link that looks like
 * Livd, arrives from Livd, and lands somewhere else. The interesting tests are
 * therefore all about refusal — and about the encodings a browser will happily
 * normalise into a host after this function has decided it was a path.
 */

describe('paths it accepts', () => {
  it.each([
    '/',
    '/review',
    '/account/reviews',
    '/property/the-franklin-brooklyn',
    '/search?q=lagos&country=NG',
    '/places/gb/london#reviews',
  ])('%s', (path) => {
    expect(safeNextPath(path)).toBe(path);
  });
});

describe('paths it refuses', () => {
  it('sends nowhere when given nothing', () => {
    expect(safeNextPath(null)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeNextPath(undefined)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeNextPath('')).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it.each([
    ['an absolute URL', 'https://evil.example/steal'],
    ['a bare host', 'evil.example'],
    ['a protocol-relative URL', '//evil.example'],
    ['a protocol-relative URL with a path', '//evil.example/looks/like/livd'],
    ['a backslash the browser will normalise', '/\\evil.example'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['a scheme-relative mailto', 'mailto:someone@example.com'],
  ])('%s', (_label, value) => {
    expect(safeNextPath(value)).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it('refuses a newline that could split the redirect header', () => {
    expect(safeNextPath('/ok\r\nLocation: https://evil.example')).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeNextPath('/ok\nSet-Cookie: a=b')).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it('refuses a null byte', () => {
    expect(safeNextPath('/ok\u0000/evil')).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it('refuses something far too long to be a route', () => {
    expect(safeNextPath(`/${'a'.repeat(600)}`)).toBe(DEFAULT_SIGNED_IN_PATH);
  });
});

describe('loops it will not create', () => {
  it('does not send a freshly signed-in person back to sign in', () => {
    expect(safeNextPath('/sign-in')).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeNextPath('/sign-in?next=%2Freview')).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it('does not send them back to the callback, which has no code left to spend', () => {
    expect(safeNextPath('/auth/callback')).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeNextPath('/auth/callback?code=abc')).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it('still allows an ordinary path that merely starts with the same letters', () => {
    expect(safeNextPath('/sign-in-help')).toBe('/sign-in-help');
  });
});

describe('the guards that produce these values', () => {
  it('round-trips what requireUserPage encodes', () => {
    // `requireUserPage('/review')` redirects to /sign-in?next=%2Freview, and
    // the page decodes it before this function sees it.
    const encoded = encodeURIComponent('/review');
    expect(safeNextPath(decodeURIComponent(encoded))).toBe('/review');
  });

  it('keeps a query string a protected page depended on', () => {
    expect(safeNextPath('/property/x/claim?from=owner')).toBe('/property/x/claim?from=owner');
  });
});
