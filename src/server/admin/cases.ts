import 'server-only';

import { z } from 'zod';

import type {
  CaseCategory,
  CaseEvent,
  CaseNote,
  CasePage,
  CaseSummary,
  ReviewReport,
} from '@/types/domain';
import { fromDatabaseError, refused } from './errors';
import { runAdminAction, type AdminResult } from './run';

/**
 * Case operations.
 *
 * Every write here has `action` set, so the administrative audit log records
 * who worked which case — separately from the case's own timeline, which
 * records what happened to it. The two answer different questions and both get
 * asked: "what happened to LV-1048" is the timeline, "what has this moderator
 * been doing" is the audit log.
 *
 * The timeline entry itself is written by the database, in the same transaction
 * as the change. That is why none of these operations append to it by hand: a
 * status that moved without an event is not a state Postgres can reach, and
 * making the application responsible for the pairing would give up exactly that
 * guarantee.
 */

const openSchema = z.object({
  category: z.string().min(1).max(64),
  summary: z.string().trim().min(3, 'Give the case a one-line summary.').max(500),
  fromReportId: z.string().max(80).nullable().default(null),
  reviewId: z.string().max(80).nullable().default(null),
  priority: z.enum(['low', 'medium', 'high', 'critical']).nullable().default(null),
});

/**
 * Opens a case.
 *
 * Note what this does not do: nothing at all to the review it concerns. It is
 * not hidden, not flagged, not touched. If opening a case had a visible effect,
 * opening cases would become the attack — the same reasoning that stops a
 * report from hiding anything on its own.
 */
export async function openCase(raw: unknown): Promise<AdminResult<{ caseId: string }>> {
  return runAdminAction<z.infer<typeof openSchema>, { caseId: string }>(
    {
      action: 'case_created',
      requires: 'moderator',
      schema: openSchema,
      subject: () => ({ type: 'case', id: null }),
      detail: (input, output) => ({
        category: input.category,
        caseId: output?.caseId ?? null,
        fromReport: input.fromReportId,
      }),

      run: async ({ actor, repository }, input) => {
        // Raising a case straight to critical is the same judgement as raising
        // an existing one, and needs the same authorisation. Checked in the
        // database too.
        if (input.priority === 'critical') {
          throw refused(
            'Open the case first, then raise it to critical — that step needs Trust & Safety authorisation.',
          );
        }

        try {
          const caseId = await repository.openCase({
            category: input.category,
            summary: input.summary,
            fromReportId: input.fromReportId,
            reviewId: input.reviewId,
            priority: input.priority,
            actorId: actor.id,
          });

          return { caseId };
        } catch (error) {
          throw caseRefusal(error, 'That case could not be opened.');
        }
      },
    },
    raw,
  );
}

const assignSchema = z.object({
  caseId: z.string().min(1).max(80),
  assigneeId: z.string().max(80).nullable().default(null),
});

export async function assignCase(raw: unknown): Promise<AdminResult<null>> {
  return runAdminAction<z.infer<typeof assignSchema>, null>(
    {
      action: 'case_assigned',
      requires: 'moderator',
      schema: assignSchema,
      subject: (input) => ({ type: 'case', id: input.caseId }),
      detail: (input) => ({ assignee: input.assigneeId }),

      run: async ({ actor, repository }, input) => {
        try {
          await repository.assignCase(input.caseId, input.assigneeId, actor.id);
          return null;
        } catch (error) {
          throw caseRefusal(error, 'That case could not be assigned.');
        }
      },
    },
    raw,
  );
}

const statusSchema = z.object({
  caseId: z.string().min(1).max(80),
  status: z.enum([
    'new',
    'open',
    'investigating',
    'awaiting_information',
    'action_taken',
    'escalated',
    'resolved',
    'dismissed',
    'closed',
  ]),
  outcome: z.string().trim().max(2000).nullable().default(null),
});

/**
 * Moves a case along.
 *
 * A concluding status needs an outcome written down. That is the point of the
 * whole object: somebody reading LV-1048 in a year should find what was
 * decided, not merely that it stopped being open.
 */
export async function setCaseStatus(raw: unknown): Promise<AdminResult<null>> {
  return runAdminAction<z.infer<typeof statusSchema>, null>(
    {
      action: 'case_status_changed',
      requires: 'moderator',
      schema: statusSchema,
      subject: (input) => ({ type: 'case', id: input.caseId }),
      detail: (input) => ({ status: input.status }),

      run: async ({ actor, repository }, input) => {
        const concluding = ['resolved', 'dismissed', 'closed'].includes(input.status);

        if (concluding && (input.outcome ?? '').trim().length < 3) {
          throw refused('Say what was decided before closing a case.');
        }

        try {
          await repository.setCaseStatus(input.caseId, input.status, input.outcome, actor.id);
          return null;
        } catch (error) {
          throw caseRefusal(error, 'That case could not be updated.');
        }
      },
    },
    raw,
  );
}

const prioritySchema = z.object({
  caseId: z.string().min(1).max(80),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  why: z.string().trim().max(500).nullable().default(null),
});

export async function setCasePriority(raw: unknown): Promise<AdminResult<null>> {
  return runAdminAction<z.infer<typeof prioritySchema>, null>(
    {
      action: 'case_priority_changed',
      requires: 'moderator',
      schema: prioritySchema,
      subject: (input) => ({ type: 'case', id: input.caseId }),
      detail: (input) => ({ priority: input.priority }),

      run: async ({ actor, repository }, input) => {
        try {
          await repository.setCasePriority(input.caseId, input.priority, input.why, actor.id);
          return null;
        } catch (error) {
          throw caseRefusal(error, 'That priority could not be changed.');
        }
      },
    },
    raw,
  );
}

const noteSchema = z.object({
  caseId: z.string().min(1).max(80),
  body: z.string().trim().min(1, 'A note needs something in it.').max(4000),
});

/**
 * Adds an internal note.
 *
 * Never shown to the reviewer, the reporter, the property owner or the public,
 * and not editable afterwards by anybody including its author — a note that can
 * be rewritten later is worth nothing as a record of what was thought at the
 * time.
 */
export async function addCaseNote(raw: unknown): Promise<AdminResult<null>> {
  return runAdminAction<z.infer<typeof noteSchema>, null>(
    {
      action: 'case_note_added',
      requires: 'moderator',
      schema: noteSchema,
      subject: (input) => ({ type: 'case', id: input.caseId }),

      run: async ({ actor, repository }, input) => {
        try {
          await repository.addCaseNote(input.caseId, input.body, actor.id);
          return null;
        } catch (error) {
          throw caseRefusal(error, 'That note could not be added.');
        }
      },
    },
    raw,
  );
}

const preservationSchema = z.object({
  caseId: z.string().min(1).max(80),
  hold: z.boolean(),
  reason: z.string().trim().min(3, 'Record why, for the audit trail.').max(500),
});

/**
 * Puts a case under preservation hold, or lifts one.
 *
 * The hook a retention policy will use. It exists now because architecture that
 * made preservation impossible later is far harder to undo than a boolean is to
 * add.
 */
export async function setCasePreservation(raw: unknown): Promise<AdminResult<null>> {
  return runAdminAction<z.infer<typeof preservationSchema>, null>(
    {
      action: 'case_status_changed',
      requires: 'trust_admin',
      schema: preservationSchema,
      subject: (input) => ({ type: 'case', id: input.caseId }),
      reason: (input) => input.reason,
      detail: (input) => ({ preservationHold: input.hold }),

      run: async ({ actor, repository }, input) => {
        try {
          await repository.setCasePreservation(
            input.caseId,
            input.hold,
            input.reason,
            actor.id,
          );
          return null;
        } catch (error) {
          throw caseRefusal(error, 'That hold could not be changed.');
        }
      },
    },
    raw,
  );
}

/* -------------------------------------------------------------------------
 * Reads
 *
 * Not audited. A case list is the working surface of the job — recording every
 * glance at it would bury the entries that matter under thousands that do not,
 * and the thing worth being accountable for is crossing the identity boundary,
 * not opening a queue.
 * ---------------------------------------------------------------------- */

export async function listCases(
  filters: Parameters<
    Awaited<ReturnType<typeof import('@/server/data').getRepository>>['listCases']
  >[0] = {},
): Promise<CasePage> {
  const { getRepository } = await import('@/server/data');
  const repository = await getRepository();
  return repository.listCases(filters);
}

export async function readCase(caseId: string): Promise<{
  detail: CaseSummary;
  events: CaseEvent[];
  notes: CaseNote[];
  reports: ReviewReport[];
} | null> {
  const { getRepository } = await import('@/server/data');
  const repository = await getRepository();

  const detail = await repository.getCase(caseId);
  if (!detail) return null;

  const [events, notes, reports] = await Promise.all([
    repository.listCaseEvents(caseId),
    repository.listCaseNotes(caseId),
    repository.listCaseReports(caseId),
  ]);

  return { detail, events, notes, reports };
}

export async function caseCategories(): Promise<CaseCategory[]> {
  const { getRepository } = await import('@/server/data');
  const repository = await getRepository();
  return repository.listCaseCategories();
}

/**
 * Case refusals worth showing.
 *
 * The `livd_*_case` functions raise messages written for a person; those are
 * passed through. Anything else becomes a generic line, because error text is
 * where schema detail leaks.
 */
function caseRefusal(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : '';

  const recognised = [
    'Only a moderator may open a case',
    'Only a moderator may assign a case',
    'Only a moderator may change a case',
    'Only a moderator may add a note',
    'A case needs a one-line summary',
    'Select a category for this case',
    'A case can only be assigned to an active moderator',
    'Say what was decided before closing a case',
    'Raising a case to critical requires Trust and Safety authorisation',
    'Preservation holds require Trust and Safety authorisation',
    'A reason is required, for the audit trail',
    'A note needs something in it',
    'No such case',
    'No such report',
  ];

  const match = recognised.find((message) => raw.includes(message));
  return match ? refused(`${match}.`) : fromDatabaseError(error, fallback);
}
