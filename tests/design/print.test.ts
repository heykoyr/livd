import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * What Livd looks like on paper.
 *
 * A browser does not print background colours, so a page read in the dark
 * theme printed pale ink onto a white sheet: text at the edge of legibility,
 * and a logo that was genuinely invisible, the dark theme's file being the
 * white one. Print therefore restores the light palette — the one designed for
 * a white ground.
 *
 * That restoration is a second copy of the palette, which is the kind of thing
 * that rots quietly: a token added to the dark theme next year would simply
 * not be restored, and nobody prints a page to find out. So the two are
 * compared here, token for token, against the values the light theme actually
 * declares.
 */

// `process.cwd()` rather than `import.meta.url`: these run in jsdom, where
// import.meta.url is not a file: URL. Same reasoning as contrast.test.ts.
const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

/** Every `--custom-property: value;` in a slice of the stylesheet. */
const declarations = (block: string) =>
  new Map(
    [...block.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name!,
      value!.replace(/\s+/g, ' ').trim(),
    ]),
  );

const darkAt = css.indexOf("[data-theme='dark'] {");
const printAt = css.indexOf('@media print {');

const light = declarations(css.slice(0, darkAt));
const dark = declarations(css.slice(darkAt, printAt));
const print = declarations(css.slice(printAt));

describe('the print stylesheet', () => {
  it('exists, and comes after the dark theme it has to override', () => {
    // Equal specificity: whichever is written last wins.
    expect(printAt).toBeGreaterThan(darkAt);
  });

  it('restores every token the dark theme remaps — none missed', () => {
    expect([...print.keys()].sort()).toEqual([...dark.keys()].sort());
  });

  it.each([...dark.keys()])('restores %s to the value the light theme declares', (token) => {
    expect(print.get(token)).toBe(light.get(token));
  });

  it('prints in the light colour scheme, so native controls follow too', () => {
    expect(css.slice(printAt)).toMatch(/color-scheme:\s*light/);
  });

  it('shows the light-ground logo and hides the white one', () => {
    const block = css.slice(printAt);
    expect(block).toMatch(/\[data-logo='light'\]\s*{\s*display:\s*block\s*!important/);
    expect(block).toMatch(/\[data-logo='dark'\]\s*{\s*display:\s*none\s*!important/);
  });
});
