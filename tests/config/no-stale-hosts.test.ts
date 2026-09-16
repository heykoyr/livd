import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * No shipped code may name a host Livd has moved off.
 *
 * The domain migration touched a dozen files, and the failure mode of a
 * migration like that is never the file somebody remembered — it is the one
 * nobody thought to grep, found months later in an email somebody actually
 * received. So this greps, every run.
 *
 * It reads *code*, not prose: the strings are matched against source under
 * `src/`, with line comments stripped first. A comment that explains why the
 * From address is no longer `livd.app` is documentation and must stay
 * readable; a string literal that still says `livd.app` is a live defect.
 */

const ROOT = join(import.meta.dirname, '..', '..', 'src');

/** Hosts this product has genuinely used and genuinely left. */
const RETIRED = [
  'livd-koyrstudio.vercel.app',
  'livd-psi.vercel.app',
  // The domain the default From address pointed at, and which Livd has never
  // owned. Any send from it is refused by the provider.
  'livd.app',
  // The provider's shared sandbox sender. Correct in nobody's production.
  'resend.dev',
];

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return EXTENSIONS.has(extname(path)) ? [path] : [];
  });
}

/**
 * Comments removed, strings kept.
 *
 * Deliberately crude — it is a lint, not a parser. Over-stripping would make
 * the test miss something; under-stripping only makes it complain about a
 * comment, which a human then reads.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');
}

describe('retired hostnames', () => {
  const files = sourceFiles(ROOT);

  it('finds source to check', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  for (const host of RETIRED) {
    it(`does not appear in shipped code: ${host}`, () => {
      const offenders = files.filter((file) =>
        withoutComments(readFileSync(file, 'utf8')).includes(host),
      );

      expect(offenders, `${host} still in: ${offenders.join(', ')}`).toEqual([]);
    });
  }
});
