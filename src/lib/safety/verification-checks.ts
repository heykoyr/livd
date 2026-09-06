import type {
  Property,
  Review,
  VerificationCheck,
  VerificationCheckCode,
} from '@/types/domain';

export type { VerificationCheck, VerificationCheckCode };

/**
 * Automated checks on a verification submission.
 *
 * What these are for: a moderator has to decide whether the person who wrote a
 * review actually lived there. Reading the document is the part only a person
 * can do. Everything a machine *can* settle first — is this the same document
 * somebody else already used, does the claimed tenancy fit the building, is the
 * submitter the landlord — is settled here, so the human minute is spent on the
 * judgement rather than on the arithmetic.
 *
 * What these are not: a decision. Nothing in this file grants
 * `verified_resident`. The strongest outcome is `blocking`, which stops a
 * submission that cannot be legitimate; everything else is a note attached to
 * the record for whoever opens it.
 *
 * No check reads the document. Livd does not run OCR over a tenancy agreement,
 * and the pipeline is designed so that it never has to: the evidence is hashed,
 * stored in a bucket no client role can read, and shown to a moderator through
 * a short-lived signed URL. The checks work on metadata and on what the
 * database already knows.
 */

export const VERIFICATION_LIMITS = {
  /** A photograph of a document. Anything larger is not one. */
  maxBytes: 8 * 1024 * 1024,
  acceptedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'],
  /** Submissions from one account inside a week before it is worth a note. */
  recentSubmissionCeiling: 5,
} as const;

export interface VerificationContext {
  review: Pick<Review, 'movedInMonth' | 'movedOutMonth' | 'authorId'>;
  property: Pick<Property, 'yearBuilt'>;
  /** When the submitting account was created. */
  submitterCreatedAt: string;
  /** Whether the submitter holds an approved claim on this property. */
  submitterOwnsProperty: boolean;
  /**
   * Accounts that have previously submitted this exact file, by hash. Empty for
   * a document nobody has used before.
   */
  priorSubmitterIds: string[];
  /** Verification submissions this account has made in the last seven days. */
  recentSubmissionCount: number;
  /** File metadata, as reported by the upload. */
  file: { type: string; bytes: number };
  /** Injected so the checks are deterministic under test. */
  now?: Date;
}

function monthStart(iso: string): Date {
  return new Date(`${iso.slice(0, 7)}-01T00:00:00.000Z`);
}

/**
 * Runs every check and returns what it found, worst first.
 *
 * A `blocking` result means the submission is refused outright. Everything else
 * travels with the record to the moderation queue.
 */
export function runVerificationChecks(context: VerificationContext): VerificationCheck[] {
  const now = context.now ?? new Date();
  const checks: VerificationCheck[] = [];

  /* --- The file itself ------------------------------------------------- */

  if (context.file.bytes <= 0) {
    checks.push({
      code: 'file_empty',
      severity: 'blocking',
      detail: 'The uploaded file is empty.',
    });
  }

  if (context.file.bytes > VERIFICATION_LIMITS.maxBytes) {
    checks.push({
      code: 'file_too_large',
      severity: 'blocking',
      detail: `The file is ${(context.file.bytes / 1024 / 1024).toFixed(1)}MB; the limit is ${
        VERIFICATION_LIMITS.maxBytes / 1024 / 1024
      }MB.`,
    });
  }

  if (!VERIFICATION_LIMITS.acceptedTypes.includes(context.file.type as never)) {
    checks.push({
      code: 'unsupported_file_type',
      severity: 'blocking',
      detail: `${context.file.type || 'An unrecognised file type'} is not one of the accepted formats.`,
    });
  }

  /* --- The same document, used twice ------------------------------------ */

  const others = context.priorSubmitterIds.filter((id) => id !== context.review.authorId);

  if (others.length > 0) {
    // The single strongest signal available without reading anything: one
    // tenancy agreement, several "residents". Not blocking, because a flatmate
    // legitimately holds the same document — which is exactly the judgement a
    // person should make.
    checks.push({
      code: 'evidence_reused_by_another_account',
      severity: 'note',
      detail: `This exact file has already been submitted by ${others.length} other account${
        others.length === 1 ? '' : 's'
      }. Housemates share a tenancy agreement; so do people running a campaign.`,
    });
  } else if (context.priorSubmitterIds.length > 0) {
    checks.push({
      code: 'evidence_already_submitted',
      severity: 'note',
      detail: 'This account has submitted the same file before.',
    });
  }

  /* --- Who is asking ---------------------------------------------------- */

  if (context.submitterOwnsProperty) {
    checks.push({
      code: 'submitter_owns_the_property',
      severity: 'blocking',
      detail:
        'This account holds the approved ownership claim on this property. An owner cannot verify themselves as a resident of it.',
    });
  }

  if (context.recentSubmissionCount > VERIFICATION_LIMITS.recentSubmissionCeiling) {
    checks.push({
      code: 'many_recent_submissions',
      severity: 'note',
      detail: `${context.recentSubmissionCount} verification submissions from this account in the last seven days.`,
    });
  }

  /* --- Does the claimed tenancy hold together? -------------------------- */

  const movedIn = monthStart(context.review.movedInMonth);
  const movedOut = context.review.movedOutMonth ? monthStart(context.review.movedOutMonth) : null;

  if (context.property.yearBuilt !== null && context.property.yearBuilt !== undefined) {
    // A tenancy cannot start before the building does. Compared on the year,
    // because `year_built` is a year and the move-in is pinned to a month.
    if (movedIn.getUTCFullYear() < context.property.yearBuilt) {
      checks.push({
        code: 'tenancy_predates_the_building',
        severity: 'note',
        detail: `The review says they moved in during ${movedIn.getUTCFullYear()}, and the property is recorded as built in ${context.property.yearBuilt}. One of the two is wrong.`,
      });
    }
  }

  if (movedIn.getTime() > now.getTime()) {
    checks.push({
      code: 'tenancy_in_the_future',
      severity: 'note',
      detail: 'The move-in month is in the future.',
    });
  }

  if (movedOut) {
    const registered = new Date(context.submitterCreatedAt);
    // Not suspicious on its own — people write about a flat they left years
    // ago — but worth a moderator knowing before they weigh the document.
    if (!Number.isNaN(registered.getTime()) && registered.getTime() > movedOut.getTime()) {
      checks.push({
        code: 'account_created_after_move_out',
        severity: 'note',
        detail: 'The account was created after the tenancy ended.',
      });
    }
  }

  return checks.sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'blocking' ? -1 : 1,
  );
}

/** Whether anything found refuses the submission outright. */
export function isBlocked(checks: VerificationCheck[]): boolean {
  return checks.some((check) => check.severity === 'blocking');
}
