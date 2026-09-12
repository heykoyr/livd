import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { NAV_LINKS } from '@/config/site';
import { copy } from '@/content/copy';

/**
 * Why Livd, held to what it promises.
 *
 * This is the page most likely to drift. It is the one place in the product
 * where the job is persuasion, and the failure mode of a persuasive page is
 * claiming more than the thing can do — which on a review platform is not a
 * tone problem but a liability one. So the rules are enforced rather than
 * remembered:
 *
 *   - no guarantee Livd cannot honour
 *   - no allegation about landlords, agents or any country
 *   - no dead call to action
 *   - the illustrative figures stay labelled as illustrative
 *
 * A reviewer cannot reliably catch a new sentence breaking one of these by
 * reading a diff, which is the whole reason these exist.
 */

const PAGE = join(process.cwd(), 'src', 'app', 'why-livd', 'page.tsx');
const APP = join(process.cwd(), 'src', 'app');

/** Every string in the page's copy block, flattened. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

const COPY = strings(copy.whyLivd);
const PROSE = COPY.join('\n');
const SOURCE = readFileSync(PAGE, 'utf8');

describe('the page exists and is reachable', () => {
  it('is in the primary navigation', () => {
    expect(NAV_LINKS.some((link) => link.href === '/why-livd')).toBe(true);
  });

  it('has copy to render', () => {
    // Guards against the copy block being emptied by a bad merge, which would
    // otherwise render a page of headings with nothing under them.
    expect(COPY.length).toBeGreaterThan(60);
  });
});

describe('every call to action leads somewhere real', () => {
  const hrefs = [...SOURCE.matchAll(/href="(\/[a-z0-9/-]*)"/g)].map((match) => match[1]!);

  it('links to the product, not only to itself', () => {
    expect(hrefs).toContain('/search');
    expect(hrefs).toContain('/review');
    expect(hrefs).toContain('/trust');
  });

  it('resolves every route it links to', () => {
    // A dead button on the page arguing for the product is worse than no
    // button. Checked against the filesystem rather than trusted.
    for (const href of new Set(hrefs)) {
      const page =
        href === '/'
          ? join(APP, 'page.tsx')
          : join(APP, ...href.replace(/^\//, '').split('/'), 'page.tsx');

      expect(existsSync(page), `${href} -> ${page}`).toBe(true);
    }
  });
});

describe('it promises nothing Livd cannot do', () => {
  /**
   * Phrases that would turn a description into a guarantee.
   *
   * Livd collects what residents said and shows the evidence behind it. It
   * does not prevent fraud, vet landlords, or know the truth about a
   * property, and a page that implies otherwise is both false and the kind of
   * false that gets quoted back at you.
   */
  const OVERCLAIMS = [
    /\bguarantee/i,
    /\bguaranteed\b/i,
    /\bensures?\b/i,
    /\bprevents?\s+(fraud|scams?|abuse)/i,
    /\bprotects?\s+you\s+from\b/i,
    /\bnever\s+(be\s+)?(scammed|defrauded)\b/i,
    /\balways\s+safe\b/i,
    /\brisk[-\s]free\b/i,
    /\bverified\s+means\s+true\b/i,
    /\bevery\s+bad\s+landlord\b/i,
  ];

  it.each(OVERCLAIMS)('does not claim %s', (pattern) => {
    const offending = COPY.filter((line) => pattern.test(line));
    expect(offending, offending.join('\n')).toEqual([]);
  });

  it('states the limit of a single review rather than hiding it', () => {
    // The honest counterweight to the whole page: one account is one account.
    expect(copy.whyLivd.questionLead).toMatch(/does not tell you whether/i);
    expect(PROSE).toMatch(/one person had one experience/i);
  });
});

describe('it accuses nobody', () => {
  /**
   * Housing goes wrong in ways worth naming. Naming them as categories of
   * risk is honest; naming a group of people is defamatory and, as a
   * universal claim, false. The page frames the gap as an information
   * problem, and these patterns are the shapes that framing fails in.
   */
  const ALLEGATIONS = [
    /landlords?\s+(routinely|usually|always|often|typically|generally)/i,
    /(agents?|caretakers?|managers?)\s+(routinely|usually|always|often|typically)/i,
    /\bmost\s+landlords?\b/i,
    /\bscam(mers?|ming)\b/i,
    /\b(steal|stealing|stole)\b/i,
    /\bcriminal/i,
    /\bfraudulent\s+landlord/i,
  ];

  it.each(ALLEGATIONS)('makes no claim of the form %s', (pattern) => {
    const offending = COPY.filter((line) => pattern.test(line));
    expect(offending, offending.join('\n')).toEqual([]);
  });

  it('names no country as a problem', () => {
    // Cities appear once, as a list of places sharing the same question.
    // Anything more specific than that about a place is an allegation.
    expect(copy.whyLivd.globalBody).toMatch(/Lagos/);
    expect(copy.whyLivd.globalBody).toMatch(/what is it really like to live there/i);
  });

  it('frames the gap as an information problem', () => {
    expect(copy.whyLivd.gapLead).toMatch(/information problem/i);
    // Explicitly absolves the viewing rather than implying concealment.
    expect(copy.whyLivd.gapClose).toMatch(/nobody is necessarily hiding/i);
  });
});

describe('it does not sound like a marketing deck', () => {
  const BANNED = [
    /revolutioni[sz]/i,
    /unlock\s+(powerful\s+)?insights?/i,
    /\bseamless(ly)?\b/i,
    /\bempower/i,
    /next[-\s]generation/i,
    /\bthe future of\b/i,
    /\bgame[-\s]chang/i,
    /\bcutting[-\s]edge\b/i,
    /\bleverage\b/i,
    /\bsupercharge/i,
    /join our community/i,
  ];

  it.each(BANNED)('avoids %s', (pattern) => {
    const offending = COPY.filter((line) => pattern.test(line));
    expect(offending, offending.join('\n')).toEqual([]);
  });

  it('has no exclamation marks, per the product voice', () => {
    expect(COPY.filter((line) => line.includes('!'))).toEqual([]);
  });
});

describe('the four-minute idea survives an edit', () => {
  it('makes the claim in the second person', () => {
    expect(copy.whyLivd.contributeClaim).toBe('You know something the next person does not.');
  });

  it('states the cost', () => {
    expect(copy.whyLivd.contributeMinutes).toMatch(/four minutes/i);
  });

  it('names what the reader knows, rather than asserting that they know', () => {
    // The section is only persuasive because it is specific. Six concrete
    // things, each in the second person.
    expect(copy.whyLivd.contributeKnows.length).toBeGreaterThanOrEqual(5);
    for (const line of copy.whyLivd.contributeKnows) {
      expect(line, line).toMatch(/^You know/);
    }
  });

  it('answers the anonymity objection in the same breath as the ask', () => {
    expect(copy.whyLivd.contributeAnonymity).toMatch(/never your name/i);
    expect(copy.whyLivd.contributeAnonymity).toMatch(/never to the property owner/i);
  });
});

describe('the trust section keeps both halves', () => {
  it('states the principle', () => {
    expect(copy.whyLivd.trustStatement).toBe('Anonymous to the public. Accountable to Livd.');
  });

  it('covers every mechanism the page claims', () => {
    const titles = copy.whyLivd.trustPillars.map((pillar) => pillar.title.toLowerCase()).join(' ');

    for (const mechanism of [
      'verification',
      'location',
      'recency',
      'anonymous',
      'accountable',
      'moderation',
      'owner responses',
    ]) {
      expect(titles, mechanism).toContain(mechanism);
    }
  });

  it('describes location verification as presence, never as tenancy', () => {
    // The product's own line everywhere else, and the page must not upgrade
    // it into something stronger.
    const pillar = copy.whyLivd.trustPillars.find((p) => p.title.includes('Location'));
    expect(pillar?.body).toMatch(/not proof of a tenancy/i);
  });
});

describe('what Livd will not do', () => {
  it('commits to the five that matter', () => {
    const titles = copy.whyLivd.wont.map((item) => item.title.toLowerCase()).join(' | ');

    expect(titles).toContain('rating');
    expect(titles).toContain('who wrote a review');
    expect(titles).toContain('speaks for everyone');
    expect(titles).toContain('confidence');
    expect(titles).toContain('listing');
  });
});

describe('the illustrative figures stay labelled', () => {
  it('renders example data only behind a label', () => {
    // The page argues that Livd never manufactures confidence. Printing
    // invented figures that read as a real building would refute it.
    expect(SOURCE).toMatch(/knowIllustration\b/);
    expect(SOURCE).toMatch(/knowIllustrationNote/);
    expect(copy.whyLivd.knowIllustrationNote).toMatch(/not a real property/i);
  });

  it('names no property for the example', () => {
    expect(copy.whyLivd.knowIllustrationTitle).not.toMatch(/court|house|heights|street|avenue/i);
  });
});

describe('metadata', () => {
  it('sets a canonical, a description and OpenGraph', () => {
    expect(SOURCE).toMatch(/alternates:\s*\{\s*canonical/);
    expect(SOURCE).toMatch(/openGraph:/);
    expect(SOURCE).toMatch(/description:/);
  });

  it('does not keyword-stuff the description', () => {
    const description =
      SOURCE.match(/description:\s*\n?\s*'([^']+)'/)?.[1] ??
      SOURCE.match(/description:\s*'([^']+)'/)?.[1] ??
      '';

    expect(description.length).toBeGreaterThan(60);
    expect(description.length).toBeLessThan(320);
    // "Livd" once or twice is identity; five times is stuffing.
    expect((description.match(/Livd/g) ?? []).length).toBeLessThanOrEqual(2);
  });
});
