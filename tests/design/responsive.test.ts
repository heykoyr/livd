import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The one responsive rule a person cannot see by looking.
 *
 * The admin console scrolled a 375px viewport sideways to 1,304px, and the
 * cause was three characters of missing CSS rather than anything visible in a
 * component: a grid declared as
 *
 *     grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)]
 *
 * has no column definition below `lg`, so the single implicit track is `auto`
 * — sized to its widest content rather than to its container. One wide child
 * then stretches the track past the viewport and takes the whole document
 * with it. `overflow-x-auto` on that child does not help: a scroll container
 * still contributes its intrinsic width to an auto-sized track.
 *
 * The fix is a definite base track (`grid-cols-1`, which Tailwind emits as
 * `repeat(1, minmax(0, 1fr))`), and this test is here because the failure is
 * silent on every desktop and total on every phone. Nobody was going to catch
 * the next one by review.
 */

const SOURCE_ROOT = join(process.cwd(), 'src');

/** Every breakpoint Tailwind is configured with, plus the container queries. */
const VARIANT = /(?:^|[\s:])(sm|md|lg|xl|2xl|max-sm|max-md|max-lg):grid-cols-/;

function sourceFiles(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (entry.endsWith('.tsx')) {
      found.push(path);
    }
  }

  return found;
}

/** Every `className="…"` literal in a file, with its line number. */
function classLists(source: string): Array<{ line: number; value: string }> {
  const lists: Array<{ line: number; value: string }> = [];
  const lines = source.split('\n');

  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(/className=(?:"([^"]*)"|'([^']*)')/g)) {
      lists.push({ line: index + 1, value: match[1] ?? match[2] ?? '' });
    }
    // `cn('…', '…')` and template literals inside className={…} are scanned
    // as plain strings too, so a grid built up conditionally is still seen.
    for (const match of line.matchAll(/'([^']*grid-cols-[^']*)'/g)) {
      lists.push({ line: index + 1, value: match[1] ?? '' });
    }
  }

  return lists;
}

describe('responsive grids', () => {
  const files = sourceFiles(SOURCE_ROOT);

  it('finds the components to check', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('never leaves a responsive grid with an implicit auto track below its breakpoint', () => {
    const offences: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');

      for (const { line, value } of classLists(source)) {
        if (!VARIANT.test(value)) continue;

        // A base definition is any `grid-cols-…` not preceded by a variant.
        const hasBase = /(?:^|\s)grid-cols-/.test(value);
        if (hasBase) continue;

        offences.push(`${file.replace(process.cwd(), '.')}:${line} — ${value}`);
      }
    }

    expect(offences, offences.join('\n')).toEqual([]);
  });
});

describe('overflow is fixed rather than hidden', () => {
  it('does not clip the document horizontally in globals.css', () => {
    const css = readFileSync(join(SOURCE_ROOT, 'app', 'globals.css'), 'utf8');

    // `overflow-x: hidden` on the root conceals a broken layout instead of
    // fixing it, and takes the content that overflowed with it. If this ever
    // becomes necessary, the element that overflows is the bug.
    const rootClip =
      /(?:html|body)[^{]*\{[^}]*overflow(?:-x)?\s*:\s*(?:hidden|clip)/s.test(css);

    expect(rootClip).toBe(false);
  });
});
