import 'server-only';

/**
 * The privileged administrative layer.
 *
 *     Admin UI
 *        ↓
 *     Server Action          thin: parses a FormData, returns a form state
 *        ↓
 *     src/server/admin/      authenticate → authorise → validate →
 *        ↓                   business rule → mutate/read → audit
 *     Repository
 *        ↓
 *     Postgres               RLS, column privileges, SECURITY DEFINER
 *                            functions — the layer that actually enforces it
 *
 * Nothing here is the security boundary. Every rule this layer applies is
 * applied again by the database against `auth.uid()`, which is what makes the
 * guarantees hold for a request that arrives at PostgREST without passing
 * through any of this. What the layer buys is that the rules are stated once,
 * legibly, in one directory a reviewer can read end to end — and that the audit
 * entry is emitted by the wrapper rather than by whichever operation remembered
 * to write one.
 *
 * That second part is the reason it exists. Before it, `setUserRole` wrote an
 * audit row and `createVerificationEvidenceLink` — which hands a moderator a
 * tenancy agreement carrying a name, an address and a signature — wrote
 * nothing at all. Not because anybody decided reading a document did not
 * matter, but because auditing was each method's own business and that one had
 * never been given the job.
 */

export { runAdminAction, type AdminContext, type AdminResult } from './run';
export { AdminActionError, notAuthorised, refused, fromDatabaseError } from './errors';
export {
  REASON_REQUIRED,
  type AdminAuditAction,
  type AdminAuditEntry,
  type AdminAuditOutcome,
  type AdminSubjectType,
} from './audit';
export {
  revealIdentity,
  identityAccessReasons,
  identityAccessHistory,
  type RevealIdentityInput,
} from './identity';
export {
  changeUserRole,
  changeUserStatus,
  readUserDirectory,
  readUserDetail,
} from './users';
