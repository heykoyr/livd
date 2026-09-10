import 'server-only';

import { z } from 'zod';

import type { AuthorityRequest, DisclosureRecord } from '@/types/domain';
import { fromDatabaseError, refused } from './errors';
import { runAdminAction, type AdminResult } from './run';

/**
 * Authority requests.
 *
 * The most restricted area in the product, and the smallest in capability.
 * Everything here records or reads. **Nothing here gathers or transmits the
 * information a request asks for**, and no function in this file, in the
 * repository, or in migration 0033 could — there is no code path from an
 * authority request to an email address, a review, a verification record or a
 * location check.
 *
 * That absence is the design rather than an unfinished feature. A button that
 * assembles and sends an account's data on request is a button that will
 * eventually be pressed for a request nobody read properly, and the entire
 * point of a process like this is that a person reads the request properly.
 * What the software does is remember: who asked, on what basis, what was
 * decided, by whom, and what actually left. The judgement stays with people;
 * the record of it does not.
 *
 * `action: null` throughout, because the database writes each audit entry in
 * the same transaction as the row it describes.
 */

const openSchema = z.object({
  requestingAuthority: z.string().trim().min(2, 'Name the requesting authority.').max(200),
  jurisdiction: z.string().trim().min(2, 'Name the jurisdiction.').max(120),
  requestType: z.enum([
    'account_information',
    'content_preservation',
    'content_removal',
    'emergency_disclosure',
    'other',
  ]),
  requestedInformation: z.string().trim().min(3, 'Record what was asked for.').max(4000),
  externalReference: z.string().trim().max(120).nullable().default(null),
  legalBasis: z.string().trim().max(2000).nullable().default(null),
  documentationReceived: z.boolean().default(false),
  subjectUserId: z.string().max(80).nullable().default(null),
  caseId: z.string().max(80).nullable().default(null),
});

export async function openAuthorityRequest(
  raw: unknown,
): Promise<AdminResult<{ requestId: string }>> {
  return runAdminAction<z.infer<typeof openSchema>, { requestId: string }>(
    {
      action: null,
      requires: 'trust_admin',
      schema: openSchema,
      subject: () => ({ type: 'authority_request', id: null }),

      run: async ({ actor, repository }, input) => {
        try {
          const requestId = await repository.openAuthorityRequest({
            ...input,
            actorId: actor.id,
          });
          return { requestId };
        } catch (error) {
          throw authorityRefusal(error, 'That request could not be recorded.');
        }
      },
    },
    raw,
  );
}

const decideSchema = z.object({
  requestId: z.string().min(1).max(80),
  status: z.enum([
    'received',
    'under_review',
    'needs_clarification',
    'awaiting_legal_review',
    'approved',
    'partially_approved',
    'declined',
    'fulfilled',
    'closed',
  ]),
  decision: z.string().trim().max(4000).nullable().default(null),
  documentationReceived: z.boolean().nullable().default(null),
});

/**
 * Moves a request along.
 *
 * A concluding status needs the decision written down. "Declined" with no
 * reasoning is precisely the record somebody will be asked about later.
 */
export async function decideAuthorityRequest(raw: unknown): Promise<AdminResult<null>> {
  return runAdminAction<z.infer<typeof decideSchema>, null>(
    {
      action: null,
      requires: 'trust_admin',
      schema: decideSchema,
      subject: (input) => ({ type: 'authority_request', id: input.requestId }),

      run: async ({ actor, repository }, input) => {
        const concluding = [
          'approved',
          'partially_approved',
          'declined',
          'fulfilled',
          'closed',
        ].includes(input.status);

        if (concluding && (input.decision ?? '').trim().length < 3) {
          throw refused('Write the decision before concluding a request.');
        }

        try {
          await repository.decideAuthorityRequest({ ...input, actorId: actor.id });
          return null;
        } catch (error) {
          throw authorityRefusal(error, 'That request could not be updated.');
        }
      },
    },
    raw,
  );
}

const discloseSchema = z.object({
  requestId: z.string().min(1).max(80),
  /**
   * Exactly what left, named one field at a time.
   *
   * There is no "everything" value and no default, which is the point: naming
   * the fields is the moment "we sent them the account" becomes "we sent them
   * the registration date and nothing else".
   */
  disclosedFields: z
    .array(z.string().trim().min(1).max(64))
    .min(1, 'Name exactly what was disclosed.')
    .max(30),
  disclosedTo: z.string().trim().min(2, 'Record who received it.').max(200),
  method: z.enum(['secure_email', 'portal', 'post', 'in_person', 'other']),
  notes: z.string().trim().max(2000).nullable().default(null),
});

/**
 * Records that a person disclosed something.
 *
 * Discloses nothing. The information itself was gathered and sent by a human,
 * outside this system, after reading the request — and this writes down what
 * that was.
 */
export async function recordDisclosure(
  raw: unknown,
): Promise<AdminResult<{ disclosureId: string }>> {
  return runAdminAction<z.infer<typeof discloseSchema>, { disclosureId: string }>(
    {
      action: null,
      requires: 'trust_admin',
      schema: discloseSchema,
      subject: (input) => ({ type: 'authority_request', id: input.requestId }),

      run: async ({ actor, repository }, input) => {
        try {
          const disclosureId = await repository.recordDisclosure({
            ...input,
            actorId: actor.id,
          });
          return { disclosureId };
        } catch (error) {
          throw authorityRefusal(error, 'That disclosure could not be recorded.');
        }
      },
    },
    raw,
  );
}

export async function listAuthorityRequests(options: {
  status?: AuthorityRequest['status'] | null;
  openOnly?: boolean;
  limit?: number;
} = {}): Promise<AuthorityRequest[]> {
  const { getRepository } = await import('@/server/data');
  const repository = await getRepository();

  try {
    return await repository.listAuthorityRequests(options);
  } catch {
    // A moderator reaching this page gets an empty list rather than a stack
    // trace. The database is what refuses them, and it already has.
    return [];
  }
}

export async function listDisclosures(requestId?: string | null): Promise<DisclosureRecord[]> {
  const { getRepository } = await import('@/server/data');
  const repository = await getRepository();

  try {
    return await repository.listDisclosures(requestId ?? null);
  } catch {
    return [];
  }
}

function authorityRefusal(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : '';

  const recognised = [
    'Recording an authority request requires Trust and Safety authorisation',
    'Deciding an authority request requires Trust and Safety authorisation',
    'Recording a disclosure requires Trust and Safety authorisation',
    'Write the decision before concluding a request',
    'That request has not been approved',
    'Name exactly what was disclosed',
    'Record who received it',
    'Name the requesting authority',
    'Name the jurisdiction',
    'Record what was asked for',
    'No such request',
  ];

  const match = recognised.find((message) => raw.includes(message));
  return match ? refused(`${match}.`) : fromDatabaseError(error, fallback);
}
