/**
 * Content safety.
 *
 * Runs server-side on every review body and owner response before anything is
 * persisted. It is the mechanism behind the product's central safety rule:
 *
 *   Reviews are about the property and the experience of living in it —
 *   never about identifiable individuals.
 *
 * Two outcomes:
 *
 *   `block` — the submission is refused and the writer is told precisely what
 *             to change. Used where the fix is obvious and the risk is to a
 *             real person: contact details, unit numbers, named individuals,
 *             threats, discriminatory targeting.
 *
 *   `flag`  — the review is accepted but routed to moderation. Used where the
 *             text may be entirely legitimate and a human needs to read it:
 *             serious allegations, aggressive framing.
 *
 * The linter is deliberately conservative about blocking and generous about
 * flagging. A false block silences a resident with something true to say; a
 * false flag costs a moderator thirty seconds.
 */

import { DISCRIMINATORY_TERMS, SLUR_PATTERNS } from './blocklist';

export type SafetySeverity = 'block' | 'flag';

export type SafetyCode =
  | 'contact_details'
  | 'unit_number'
  | 'named_individual'
  | 'threat'
  | 'discrimination'
  | 'unverified_allegation'
  | 'aggressive_tone'
  | 'excessive_caps';

export interface SafetyIssue {
  code: SafetyCode;
  severity: SafetySeverity;
  /** The matched text, so the UI can point at it. Never logged verbatim. */
  excerpt: string;
}

export interface SafetyResult {
  /** False when any blocking issue was found. */
  ok: boolean;
  blocks: SafetyIssue[];
  flags: SafetyIssue[];
  /** Codes for `reviews.safety_flags`, for moderator triage. */
  flagCodes: SafetyCode[];
}

/* -------------------------------------------------------------------------
 * Contact details
 * ---------------------------------------------------------------------- */

const EMAIL = /\b[\w.+-]+\s*(?:@|\(at\)|\[at\]|\s+at\s+)\s*[\w-]+(?:\s*(?:\.|\(dot\)|\[dot\])\s*[\w-]+)+\b/gi;

/**
 * Phone numbers, internationally.
 *
 * Matches a leading +, or any run of 7+ digits allowing spaces, dots, hyphens
 * and parentheses as separators — which covers every national format without
 * assuming any particular one. Deliberately loose; a false positive here costs
 * a writer one edit.
 */
const PHONE = /(?:\+\d[\d\s().-]{6,}\d)|(?:\b(?:\d[\s.-]?){7,}\d\b)/g;

/**
 * A parenthesised area code — "(415) 555-0132".
 *
 * Needs its own pattern because parentheses are not in the separator class
 * above, and widening that class would start matching year ranges like
 * "2019 - 2026" as phone numbers.
 */
const PHONE_PARENTHESISED = /\(\d{2,5}\)[\s.-]*\d(?:[\s.-]?\d){5,}/g;

/** Digits spelled out to dodge the numeric matcher. */
const SPELLED_PHONE =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine)(?:[\s-]+(?:zero|one|two|three|four|five|six|seven|eight|nine)){6,}\b/gi;

const URL = /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|net|org|io|co|ng|uk|ca|au|de|nl|fr|ie|za|info|biz)\b(?:\/\S*)?/gi;

/** Messaging handles: @name, "whatsapp me on", "dm me". */
const HANDLE = /(?:^|\s)@[A-Za-z][\w.]{2,}\b/g;
const MESSAGING = /\b(?:whats\s?app|telegram|signal|snapchat|instagram|dm\s+me|text\s+me\s+on)\b/gi;

/* -------------------------------------------------------------------------
 * Unit identification
 * ---------------------------------------------------------------------- */

/**
 * Unit, apartment and flat numbers.
 *
 * A unit number identifies a household, not a property. Publishing "the people
 * in Flat 4B were awful" is a privacy failure regardless of whether it is true.
 */
const UNIT_NUMBER =
  /\b(?:apt|apartment|flat|unit|suite|door|room)\s*(?:number|no\.?|#)?\s*[#]?\s*\d{1,4}\s*[a-z]?\b/gi;
const HASH_UNIT = /(?:^|\s)#\s?\d{1,4}[a-z]?\b/gi;

/* -------------------------------------------------------------------------
 * Named individuals
 * ---------------------------------------------------------------------- */

/**
 * A title followed by a name.
 *
 * Covers the honorifics common across Livd's launch markets rather than
 * assuming an anglophone naming convention.
 *
 * Built rather than written literally, because case handling has to differ per
 * title. The pattern cannot simply carry the `i` flag: that would relax
 * `[A-Z][a-z]{2,}` too and match "Mr and", "Dr for" and similar. So a title's
 * first letter is accepted in either case while the *name* stays strictly
 * capitalised.
 *
 * A few titles are ordinary English words as well — "miss", "sir", "lady",
 * "lord" — and matching those lowercase would block "I will miss London".
 * Those are recognised only when capitalised.
 */
const TITLES_ANY_CASE = [
  'mr', 'mrs', 'ms', 'dr', 'prof', 'chief', 'alhaji', 'alhaja', 'hajia',
  'engr', 'barr', 'pastor', 'imam', 'rev', 'herr', 'frau', 'monsieur',
  'madame', 'señor', 'señora',
];

/** Also ordinary English words, so only the capitalised form counts. */
const TITLES_CAPITALISED_ONLY = ['Miss', 'Sir', 'Madam', 'Lord', 'Lady'];

const TITLE_ALTERNATION = [
  ...TITLES_ANY_CASE.map(
    (title) => `[${title.charAt(0).toUpperCase()}${title.charAt(0)}]${title.slice(1)}`,
  ),
  ...TITLES_CAPITALISED_ONLY,
].join('|');

const TITLED_NAME = new RegExp(`\\b(?:${TITLE_ALTERNATION})\\.?\\s+[A-Z][a-z]{2,}`, 'g');

/**
 * A role word followed by a capitalised name — "the landlord Michael",
 * "our caretaker Grace", "manager called David".
 */
const ROLE_THEN_NAME =
  /\b(?:landlord|landlady|manager|agent|caretaker|concierge|security|guard|janitor|super|superintendent|owner|neighbour|neighbor|tenant|resident)\s+(?:is\s+|was\s+|called\s+|named\s+|,\s*)?([A-Z][a-z]{2,})\b/g;

/**
 * Words that follow a role and are not names. Without this, "the landlord
 * Never fixed anything" would flag on sentence capitalisation.
 */
const NOT_A_NAME = new Set([
  'Never', 'Always', 'He', 'She', 'They', 'It', 'We', 'I', 'The', 'This', 'That',
  'There', 'Then', 'When', 'Would', 'Will', 'Was', 'Were', 'Did', 'Does', 'Had',
  'Has', 'Just', 'Only', 'Also', 'But', 'And', 'However', 'Although', 'Every',
  'Once', 'Even', 'Still', 'Simply', 'Refused', 'Ignored', 'Took', 'Kept',
]);

/* -------------------------------------------------------------------------
 * Threats and harassment
 * ---------------------------------------------------------------------- */

const THREAT =
  /\b(?:i(?:'| a)?m\s+going\s+to\s+|i\s+will\s+|i'll\s+|we\s+will\s+|we'll\s+)(?:kill|hurt|harm|beat|attack|burn|destroy|find|deal\s+with|get)\b|\bwatch\s+your\s+back\b|\byou(?:'| a)?re\s+dead\b|\bburn\s+(?:it|the\s+place|the\s+building)\s+down\b/gi;

const HARASSMENT_DIRECTED =
  /\b(?:he|she|they)\s+(?:is|are|was|were)\s+(?:a\s+)?(?:disgusting|worthless|vile|scum|filth|subhuman)\b/gi;

/* -------------------------------------------------------------------------
 * Allegations
 * ---------------------------------------------------------------------- */

/**
 * Serious accusations stated as established fact.
 *
 * Flagged, never blocked. A resident whose deposit was genuinely stolen must be
 * able to say so — but a flat accusation against an identifiable business needs
 * a human to read it before it becomes part of a permanent public record.
 */
const ALLEGATION =
  /\b(?:is|are|was|were)\s+(?:a\s+)?(?:thief|thieves|fraud|fraudster|criminal|scammer|con\s+artist|paedophile|pedophile|rapist|murderer)\b|\b(?:stole|scammed|defrauded|assaulted|attacked)\s+(?:me|us|my|our)\b/gi;

/** Hedging that turns an accusation into a personal account. */
const HEDGE =
  /\b(?:i\s+(?:believe|think|felt|feel|was\s+told|understood|suspect)|in\s+my\s+(?:experience|view|opinion)|allegedly|apparently|it\s+(?:seemed|felt)\s+like|from\s+what\s+i)\b/i;

const AGGRESSIVE =
  /\b(?:shut\s+up|idiot|moron|stupid\s+(?:man|woman|people)|scumbag|bastard|piece\s+of\s+shit)\b/gi;

/* -------------------------------------------------------------------------
 * Linter
 * ---------------------------------------------------------------------- */

/**
 * Collapses the obfuscation people use to slip past filters: zero-width
 * characters, repeated punctuation between letters, and lookalike digits.
 */
function normalise(text: string): string {
  return text
    .replace(/[​-‍﻿]/g, '')
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))
    .normalize('NFKC');
}

function addMatches(
  issues: SafetyIssue[],
  text: string,
  pattern: RegExp,
  code: SafetyCode,
  severity: SafetySeverity,
): void {
  // A fresh regex each call, so the shared /g patterns cannot carry lastIndex
  // between invocations.
  const matcher = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text)) !== null) {
    if (match[0].trim().length === 0) {
      matcher.lastIndex += 1;
      continue;
    }
    issues.push({ code, severity, excerpt: match[0].trim().slice(0, 60) });
    if (!matcher.global) break;
  }
}

export function lintContent(rawText: string | null | undefined): SafetyResult {
  const blocks: SafetyIssue[] = [];
  const flags: SafetyIssue[] = [];

  if (!rawText || rawText.trim().length === 0) {
    return { ok: true, blocks, flags, flagCodes: [] };
  }

  const text = normalise(rawText);

  /* --- Blocking --- */

  addMatches(blocks, text, EMAIL, 'contact_details', 'block');
  addMatches(blocks, text, PHONE, 'contact_details', 'block');
  addMatches(blocks, text, PHONE_PARENTHESISED, 'contact_details', 'block');
  addMatches(blocks, text, SPELLED_PHONE, 'contact_details', 'block');
  addMatches(blocks, text, URL, 'contact_details', 'block');
  addMatches(blocks, text, HANDLE, 'contact_details', 'block');
  addMatches(blocks, text, MESSAGING, 'contact_details', 'block');

  addMatches(blocks, text, UNIT_NUMBER, 'unit_number', 'block');
  addMatches(blocks, text, HASH_UNIT, 'unit_number', 'block');

  addMatches(blocks, text, TITLED_NAME, 'named_individual', 'block');
  addRoleNameMatches(blocks, text);

  addMatches(blocks, text, THREAT, 'threat', 'block');
  addMatches(blocks, text, HARASSMENT_DIRECTED, 'threat', 'block');

  for (const pattern of SLUR_PATTERNS) {
    addMatches(blocks, text, pattern, 'discrimination', 'block');
  }
  addDiscriminatoryTargeting(blocks, text);

  /* --- Flagging --- */

  // An allegation with hedging nearby is a personal account, not an accusation.
  const allegationMatcher = new RegExp(ALLEGATION.source, ALLEGATION.flags);
  let allegation: RegExpExecArray | null;
  while ((allegation = allegationMatcher.exec(text)) !== null) {
    const context = text.slice(Math.max(0, allegation.index - 120), allegation.index + 60);
    if (!HEDGE.test(context)) {
      flags.push({
        code: 'unverified_allegation',
        severity: 'flag',
        excerpt: allegation[0].trim().slice(0, 60),
      });
    }
  }

  addMatches(flags, text, AGGRESSIVE, 'aggressive_tone', 'flag');

  // Sustained shouting, ignoring short bodies and acronyms.
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length > 60) {
    const upper = text.replace(/[^A-Z]/g, '').length;
    if (upper / letters.length > 0.6) {
      flags.push({ code: 'excessive_caps', severity: 'flag', excerpt: '' });
    }
  }

  return {
    ok: blocks.length === 0,
    blocks: dedupeIssues(blocks),
    flags: dedupeIssues(flags),
    flagCodes: [...new Set([...blocks, ...flags].map((issue) => issue.code))],
  };
}

function addRoleNameMatches(issues: SafetyIssue[], text: string): void {
  const matcher = new RegExp(ROLE_THEN_NAME.source, ROLE_THEN_NAME.flags);
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text)) !== null) {
    const name = match[1];
    if (!name || NOT_A_NAME.has(name)) continue;
    issues.push({
      code: 'named_individual',
      severity: 'block',
      excerpt: match[0].trim().slice(0, 60),
    });
  }
}

/**
 * Discriminatory targeting expressed without a slur — "no <group> should be
 * allowed to live here", "too many <group> in this building".
 */
function addDiscriminatoryTargeting(issues: SafetyIssue[], text: string): void {
  const groups = DISCRIMINATORY_TERMS.join('|');
  const patterns = [
    new RegExp(
      `\\b(?:no|avoid|too\\s+many|full\\s+of|overrun\\s+with|infested\\s+with)\\s+(?:\\w+\\s+){0,2}(?:${groups})\\b`,
      'gi',
    ),
    new RegExp(
      `\\b(?:${groups})\\s+(?:people\\s+)?(?:should\\s+not|shouldn't|don't|do\\s+not)\\s+(?:be\\s+allowed|live|belong)\\b`,
      'gi',
    ),
  ];

  for (const pattern of patterns) {
    addMatches(issues, text, pattern, 'discrimination', 'block');
  }
}

function dedupeIssues(issues: SafetyIssue[]): SafetyIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.excerpt.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* -------------------------------------------------------------------------
 * Redaction
 * ---------------------------------------------------------------------- */

/**
 * Last-resort redaction for content that predates a linter rule, so a stored
 * record can never render contact details even if it slipped past submission.
 * The linter is the control; this is the safety net behind it.
 */
export function redactSensitive(text: string): string {
  return normalise(text)
    .replace(EMAIL, '[removed]')
    .replace(URL, '[removed]')
    .replace(PHONE, '[removed]')
    .replace(UNIT_NUMBER, '[unit removed]');
}
