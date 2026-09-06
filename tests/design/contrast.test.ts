import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Colour contrast, read from the stylesheet itself.
 *
 * `npm run audit:a11y` runs axe over the real pages, but through jsdom, which
 * computes no layout and resolves no custom properties — so it is structurally
 * incapable of checking contrast, and said so in a comment while the product
 * claimed the ratios had been verified. They had not: a browser-based check
 * found thirty-five failures in light mode and nineteen in dark, across six
 * tokens that had been below 4.5:1 since the palette was written.
 *
 * This closes that hole without a headless browser. It parses `globals.css`,
 * so it cannot drift from the real values, and it fails on the pair rather
 * than on the page — which is where the defect actually lives. A token used in
 * one place today is used in ten tomorrow; checking the palette catches the
 * ninth before anyone looks at it.
 *
 * Thresholds are WCAG 2.2: 4.5:1 for body text, 3:1 for text at 24px or larger
 * and for the boundaries of interface components.
 */

// `process.cwd()` rather than `import.meta.url`: these tests run in jsdom,
// where import.meta.url is not a file: URL and cannot be resolved to a path.
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

/* -------------------------------------------------------------------------
 * Reading the tokens
 * ---------------------------------------------------------------------- */

/**
 * Pulls `--color-*` declarations out of one block.
 *
 * The dark theme is a full remap under `[data-theme='dark']`; everything above
 * it is the light theme.
 */
function tokensFor(theme: 'light' | 'dark'): Record<string, string> {
  // The opening brace matters: `[data-theme='dark']` also appears near the top
  // of the file inside `@custom-variant`, long before any token is declared.
  const darkAt = CSS.indexOf("[data-theme='dark'] {");
  if (darkAt < 0) throw new Error('dark theme block not found in globals.css');

  const block = theme === 'light' ? CSS.slice(0, darkAt) : CSS.slice(darkAt);
  const tokens: Record<string, string> = {};

  for (const match of block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    // The light theme declares each token once; the dark block likewise.
    tokens[match[1]!] = match[2]!.toLowerCase();
  }

  return tokens;
}

const THEMES = { light: tokensFor('light'), dark: tokensFor('dark') };

/* -------------------------------------------------------------------------
 * The arithmetic — WCAG 2.x relative luminance
 * ---------------------------------------------------------------------- */

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/* -------------------------------------------------------------------------
 * What the design actually puts together
 * ---------------------------------------------------------------------- */

/** Backgrounds any text can land on. */
const SURFACES = ['canvas', 'surface', 'surface-sunken', 'surface-raised'];

/**
 * Foregrounds used for text at 13px or smaller.
 *
 * The score colours are here rather than under the 3:1 rule because they are
 * not only the big numeral in the dial: they also colour category scores on a
 * property card and the badges on a review, both at `text-label`.
 */
const BODY_TEXT = [
  'ink',
  'ink-muted',
  'ink-subtle',
  'brand',
  'accent',
  'score-strong',
  'score-good',
  'score-mixed',
  'score-weak',
  'score-poor',
  'score-unknown',
];

/** The tinted backgrounds chips and badges sit on. */
const SOFT_SURFACES = [
  'positive-soft',
  'caution-soft',
  'critical-soft',
  'info-soft',
  'brand-soft',
  'accent-soft',
];

/** Which tint each score band's rating pill uses — see `RatingPill`. */
const SCORE_ON_TINT: Array<[string, string]> = [
  ['score-strong', 'positive-soft'],
  ['score-good', 'positive-soft'],
  ['score-mixed', 'caution-soft'],
  ['score-weak', 'critical-soft'],
  ['score-poor', 'critical-soft'],
];

/** Tinted chips and badges: each tone on its own soft background. */
const TONE_PAIRS: Array<[string, string]> = [
  ['positive', 'positive-soft'],
  ['caution', 'caution-soft'],
  ['critical', 'critical-soft'],
  ['info', 'info-soft'],
  ['brand-ink', 'brand-soft'],
  ['accent', 'accent-soft'],
];

describe.each(['light', 'dark'] as const)('%s theme', (theme) => {
  const tokens = THEMES[theme];

  it('declares every token the checks below reference', () => {
    for (const name of [...SURFACES, ...SOFT_SURFACES, ...BODY_TEXT, ...TONE_PAIRS.flat(), ...SCORE_ON_TINT.flat()]) {
      expect(tokens[name], `--color-${name} is missing from ${theme}`).toBeDefined();
    }
  });

  describe('body text on every surface it can land on', () => {
    it.each(BODY_TEXT)('%s clears 4.5:1', (fg) => {
      for (const bg of SURFACES) {
        const ratio = contrast(tokens[fg]!, tokens[bg]!);
        expect(
          Number(ratio.toFixed(2)),
          `--color-${fg} (${tokens[fg]}) on --color-${bg} (${tokens[bg]})`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  });

  describe('neutral text on a tinted chip', () => {
    // `ink-subtle` is the third step of the neutral scale and is tuned for the
    // four neutral surfaces; on every soft tint it lands between 3.9 and 4.5,
    // and pushing it far enough to clear them would collapse it into
    // `ink-muted`. So the rule is the other way round: a chip that needs
    // secondary neutral text uses `ink-muted`, which clears every tint with
    // room to spare. A property page's active filter chip broke this rule and
    // measured 4.30:1.
    it.each(SOFT_SURFACES)('ink-muted clears 4.5:1 on %s', (bg) => {
      expect(
        Number(contrast(tokens['ink-muted']!, tokens[bg]!).toFixed(2)),
        `--color-ink-muted (${tokens['ink-muted']}) on --color-${bg} (${tokens[bg]})`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('the rating pill', () => {
    // A review's rating badge puts a *score* colour on a tone tint — the two
    // scales meet only here, so the pairing needs its own check. Three of them
    // sat between 4.29 and 4.48 against these tints while clearing every
    // neutral surface, which is exactly the gap a per-surface check misses.
    it.each(SCORE_ON_TINT)('%s on %s clears 4.5:1', (fg, bg) => {
      expect(
        Number(contrast(tokens[fg]!, tokens[bg]!).toFixed(2)),
        `--color-${fg} (${tokens[fg]}) on --color-${bg} (${tokens[bg]})`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('tinted chips', () => {
    it.each(TONE_PAIRS)('%s on %s clears 4.5:1', (fg, bg) => {
      const ratio = contrast(tokens[fg]!, tokens[bg]!);
      expect(
        Number(ratio.toFixed(2)),
        `--color-${fg} (${tokens[fg]}) on --color-${bg} (${tokens[bg]})`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('the focus ring', () => {
    // 1.4.11 at 3:1. Scoped to the focus outline rather than every border:
    // a card's hairline is decoration, and the standard asks about the parts
    // whose visibility a user depends on. Losing the focus ring loses the
    // keyboard.
    it.each(['canvas', 'surface', 'surface-sunken'])('is visible on %s', (bg) => {
      expect(
        Number(contrast(tokens.brand!, tokens[bg]!).toFixed(2)),
        `--color-brand (${tokens.brand}) on --color-${bg} (${tokens[bg]})`,
      ).toBeGreaterThanOrEqual(3);
    });
  });
});

describe('the two themes stay comparable', () => {
  it('declares the same colour tokens in both', () => {
    // A token defined in one theme and forgotten in the other renders as
    // whatever the light value happened to be, which is how a dark-mode
    // contrast failure hides.
    const missing = Object.keys(THEMES.light).filter((k) => !(k in THEMES.dark));
    expect(missing, `declared for light but not remapped for dark`).toEqual([]);
  });
});
