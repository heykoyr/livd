/**
 * Terms used by the discrimination checks in `content-linter.ts`.
 *
 * Two deliberate decisions here.
 *
 * First, `DISCRIMINATORY_TERMS` are ordinary, entirely neutral words for
 * protected characteristics. They are not offensive and are never blocked on
 * their own — a review saying "the building is mostly students" is fine. They
 * only matter as the object of a targeting *construction* ("no ___ should be
 * allowed to live here"), which is what the linter actually matches on.
 *
 * Second, `SLUR_PATTERNS` ships intentionally small. A comprehensive slur
 * dictionary does not belong in an application repository: it goes stale, it is
 * unpleasant to maintain in version control, and it is trivially evaded by
 * anyone who reads the source. In production this list is loaded at boot from a
 * maintained external source (see `docs/architecture.md` §7) and this file
 * provides the seed and the matching mechanism. The patterns below use
 * character-class separators so that spacing and punctuation evasion
 * ("s.l.u.r", "s l u r") does not defeat them.
 */

/**
 * Neutral group nouns. Harmless in isolation; matched only inside an exclusion
 * or hostility construction.
 */
export const DISCRIMINATORY_TERMS = [
  'africans?',
  'asians?',
  'arabs?',
  'blacks?',
  'whites?',
  'latinos?',
  'hispanics?',
  'jews(?:ish)?',
  'muslims?',
  'christians?',
  'hindus?',
  'sikhs?',
  'immigrants?',
  'migrants?',
  'refugees?',
  'foreigners?',
  'gays?',
  'lesbians?',
  'trans(?:gender)?',
  'disabled',
  'students?',
  'single\\s+mothers?',
  'benefit\\s+claimants?',
  'dss',
];

/** Separator class allowing spaced and punctuated evasion. */
const S = '[\\s._*\\-]{0,2}';

function evasionTolerant(word: string): RegExp {
  return new RegExp(`\\b${word.split('').join(S)}\\b`, 'gi');
}

/**
 * Seed patterns. Kept minimal and non-gratuitous — the mechanism is the point,
 * and the production list is supplied externally.
 */
export const SLUR_PATTERNS: RegExp[] = [
  // Ethnic and racial slurs.
  evasionTolerant('nigger'),
  evasionTolerant('nigga'),
  evasionTolerant('chink'),
  evasionTolerant('spic'),
  evasionTolerant('kike'),
  evasionTolerant('paki'),
  evasionTolerant('wetback'),
  evasionTolerant('coon'),
  // Slurs targeting sexuality and gender identity.
  evasionTolerant('faggot'),
  evasionTolerant('tranny'),
  // Slurs targeting disability.
  evasionTolerant('retard'),
];

/**
 * Replaces the seed patterns at boot when a maintained list is configured.
 * Kept as an explicit function so the swap is a deliberate, reviewable call
 * rather than a mutable module export other code could reach into.
 */
export function withExternalSlurList(terms: string[]): RegExp[] {
  return terms.filter((term) => term.trim().length > 1).map((term) => evasionTolerant(term.trim()));
}
