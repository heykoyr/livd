import 'server-only';

/**
 * Refusals an administrator is meant to read.
 *
 * The distinction this file draws is the whole of it. An `AdminActionError`
 * carries a message written for a person and is shown to them. Anything else —
 * a dropped connection, a constraint nobody anticipated, a bug — is not, and is
 * replaced by a generic line before it reaches a page.
 *
 * That matters more in an admin console than elsewhere. Error text is where
 * internal detail leaks: table names, column names, the shape of a query, and
 * occasionally the value that was being protected. An administrator reading
 * "permission denied for relation verification_records" has learned something
 * about the schema; one reading "You are not authorised to open this document"
 * has learned what they needed.
 */

export class AdminActionError extends Error {
  readonly outcome: 'denied' | 'failed';

  constructor(message: string, outcome: 'denied' | 'failed' = 'denied') {
    super(message);
    this.name = 'AdminActionError';
    this.outcome = outcome;
  }
}

/** Refused because of who the caller is. Recorded as a denial. */
export function notAuthorised(message = 'You are not authorised to do this.'): AdminActionError {
  return new AdminActionError(message, 'denied');
}

/** Refused because of what was asked for. Also recorded, also safe to show. */
export function refused(message: string): AdminActionError {
  return new AdminActionError(message, 'denied');
}

/**
 * Database refusals that are safe to surface.
 *
 * The messages raised by the `livd_*` functions are written for a person, so
 * they are passed through when recognised. Everything else is swallowed —
 * matching on a known list rather than on a prefix, so a new error string
 * cannot leak by resembling an old one.
 */
const RECOGNISED_DATABASE_REFUSALS = [
  'Only an administrator may change a role',
  'Only a moderator may change an account standing',
  'Only an administrator may act on a privileged account',
  'Suspending an account requires Trust and Safety authorisation',
  'You cannot change your own role',
  'You cannot change your own standing',
  'A reason is required, for the audit trail',
  'This is the last administrator and cannot be demoted',
  'Not authorised to read the user directory',
  'Not authorised to look up an account',
  'Not authorised to read the audit log',
  'No such account',
] as const;

export function fromDatabaseError(error: unknown, fallback: string): AdminActionError {
  const raw = error instanceof Error ? error.message : '';
  const match = RECOGNISED_DATABASE_REFUSALS.find((message) => raw.includes(message));

  if (match) return new AdminActionError(`${match}.`, 'denied');
  return new AdminActionError(fallback, 'failed');
}
