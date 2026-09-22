import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The sign-in email, as pasted into Supabase.
 *
 * The dashboard has no API that tests can reach, so the file is the contract
 * and this reads it. What it asserts is the architecture: the email links to
 * Livd's own confirmation page with Supabase's token hash, on the Site URL,
 * and never to Supabase's `{{ .ConfirmationURL }}` — the link that is spent on
 * opening and only works in the browser that asked for it.
 */

const template = readFileSync(join(process.cwd(), 'supabase', 'templates', 'magic-link.html'), 'utf8');
const markup = template.slice(template.indexOf('<!doctype html>'));

const LINK =
  '{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}';

describe('the sign-in link', () => {
  it('goes to /auth/confirm on the Site URL, with the token hash', () => {
    // The VML button, the anchor, and the fallback link's href and text.
    expect(markup.split(LINK)).toHaveLength(5);
  });

  it('is never the link Supabase spends on opening', () => {
    expect(template).not.toContain('{{ .ConfirmationURL }}');
    expect(template).not.toContain('/auth/v1/verify');
  });

  it('every link in it is the sign-in link, or nothing at all', () => {
    const hrefs = [...markup.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toBe(LINK);
  });

  it('carries no tracking a provider could rewrite the link with', () => {
    expect(markup).not.toMatch(/utm_|click\.|\/track|mc_eid|\bpixel\b/i);
  });

  it('offers the code for a different device', () => {
    expect(markup).toContain('{{ .Token }}');
  });

  it('keeps template variables out of its comments, where they would render', () => {
    const header = template.slice(0, template.indexOf('<!doctype html>'));
    expect(header).not.toMatch(/{{\s*\./);
  });
});

describe('what it tells the reader', () => {
  it('says it is Livd, and never Supabase', () => {
    expect(markup).toContain('Sign in to Livd');
    expect(markup).not.toMatch(/supabase/i);
  });

  it('states the lifetime Supabase is configured with, and that it works once', () => {
    expect(markup).toContain('expire in 1 hour');
    expect(markup).toContain('work once');
    expect(markup).not.toContain('15 minutes');
  });

  it('tells someone who did not ask that nothing will happen', () => {
    expect(markup).toContain('If you did not ask to sign in');
  });
});
