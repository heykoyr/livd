import 'server-only';

import type { AdminRole } from '@/types/domain';
import { getRepository } from '@/server/data';
import type { NotificationRecipient } from '@/server/data/repository';
import { categoryOf, renderNotification, type NotificationMessage } from './messages';
import { notificationHeaders } from './shell';
import { recipientDomain, sendEmail } from './transport';

/**
 * The dispatcher.
 *
 * Four guarantees, and the order they are enforced in is the design:
 *
 *   1. **It never breaks the thing it is reporting on.** Every path is
 *      wrapped. A review is published whether or not the confirmation email
 *      leaves the building, and a moderator's decision is not undone by a
 *      provider outage. Notification is a consequence of an action, never a
 *      step in it.
 *
 *   2. **It sends once.** The claim is a unique key in the database, taken
 *      *before* the message is rendered, so a retried Server Action, two
 *      concurrent callers, or five writes of the same status all resolve to
 *      one send. This is the whole of Phase 16 and it is one statement.
 *
 *   3. **It respects the switch.** A preference is read with the address, in
 *      the same call, and a message in a category somebody has turned off is
 *      settled as `skipped` rather than sent — recorded, so "why did I not
 *      get that" is answerable.
 *
 *   4. **It logs nothing that identifies anybody.** The kind, the outcome and
 *      the recipient's *domain*. Not the address, not the user id, not the
 *      message. A product whose promise is anonymity cannot keep a log of who
 *      was told what about which review.
 *
 * CALLING IT
 *
 * From a Server Action, inside `after()` from `next/server`:
 *
 *     after(() => notify({ to: authorId, dedupe: `review_published:${id}`, message }));
 *
 * `after` runs the callback once the response has been sent but while the
 * invocation is still alive, which is the difference between "the email is
 * sent" and "the email is sent if the platform happens not to freeze this
 * function first". A bare floating promise gives the second.
 */

export interface NotifyInput {
  /** The account to write to. */
  to: string;
  /**
   * The idempotency key, without the recipient. Shaped `<kind>:<subject id>`
   * so that the same real-world event computes the same key from wherever it
   * is noticed — the submit action and a moderator's restore both produce
   * `review_published:<review id>`, and only one of them sends.
   */
  dedupe: string;
  message: NotificationMessage;
}

export interface NotifyStaffInput {
  /** Everyone at this rank and above. */
  minRole: AdminRole;
  dedupe: string;
  message: NotificationMessage;
}

/** Writes to one person. Resolves to nothing and throws nothing. */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const repository = await getRepository();

    const claimed = await repository.claimNotification({
      dedupeKey: input.dedupe,
      kind: input.message.kind,
      recipientId: input.to,
      recipientKind: 'user',
      payload: summarise(input.message),
    });

    // Somebody already has this one. Not an error and not worth a log line —
    // it is the mechanism working.
    if (!claimed) return;

    const recipient = await repository.notificationRecipient(input.to);
    if (!recipient) {
      await settle(input.dedupe, 'skipped', 'no deliverable address');
      return;
    }

    if (!wants(recipient, input.message)) {
      await settle(input.dedupe, 'skipped', 'recipient has this category turned off');
      return;
    }

    await deliver(input.dedupe, recipient, input.message);
  } catch (error) {
    report(input.message.kind, error);
  }
}

/**
 * Writes to the staff who handle a thing.
 *
 * Role-derived, never a configured address. Each recipient gets their own
 * claim — `<dedupe>:<user id>` — so one person's bounce does not suppress
 * everybody else's copy, and a retry re-sends only what actually failed.
 *
 * Preferences are deliberately not consulted. Operational mail follows the
 * role, and an escalation nobody receives is not an escalation.
 */
export async function notifyStaff(input: NotifyStaffInput): Promise<void> {
  try {
    const repository = await getRepository();
    const recipients = await repository.notificationStaff(input.minRole);

    for (const recipient of recipients) {
      const key = `${input.dedupe}:${recipient.userId}`;

      const claimed = await repository.claimNotification({
        dedupeKey: key,
        kind: input.message.kind,
        recipientId: recipient.userId,
        recipientKind: input.minRole,
        payload: summarise(input.message),
      });

      if (!claimed) continue;

      await deliver(key, recipient, input.message);
    }
  } catch (error) {
    report(input.message.kind, error);
  }
}

/* -------------------------------------------------------------------------
 * Internals
 * ---------------------------------------------------------------------- */

async function deliver(
  dedupeKey: string,
  recipient: NotificationRecipient,
  message: NotificationMessage,
): Promise<void> {
  const rendered = renderNotification(message);

  const result = await sendEmail({
    to: recipient.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: notificationHeaders(),
  });

  if (result.ok) {
    await settle(dedupeKey, 'sent', result.provider === 'console' ? 'console transport' : null);
    return;
  }

  await settle(dedupeKey, 'failed', result.error);

  // The domain, never the address. Enough to tell a Gmail deliverability
  // problem from a broken provider key, and not enough to learn who uses Livd.
  console.error(
    `[livd] notification "${message.kind}" failed for @${recipientDomain(recipient.email)}: ${
      result.error
    }`,
  );
}

/**
 * Settling must not throw either.
 *
 * The email has already gone, or already failed. Losing the ledger row is a
 * worse outcome than a duplicate log line, but it is not worth unwinding an
 * action over — and re-throwing here would defeat the wrapper above by
 * arriving from a different call.
 */
async function settle(
  dedupeKey: string,
  status: 'sent' | 'failed' | 'skipped',
  detail: string | null,
): Promise<void> {
  try {
    const repository = await getRepository();
    await repository.settleNotification(dedupeKey, status, detail);
  } catch (error) {
    console.error('[livd] could not record a notification outcome', error);
  }
}

function wants(recipient: NotificationRecipient, message: NotificationMessage): boolean {
  switch (categoryOf(message.kind)) {
    case 'review_updates':
      return recipient.preferences.reviewUpdates;
    case 'property_responses':
      return recipient.preferences.propertyResponses;
    case 'trust_safety':
      return recipient.preferences.trustSafety;
  }
}

/**
 * What goes in the ledger's payload column.
 *
 * The kind plus whichever fields are short, public and useful for diagnosing
 * a delivery — a property slug, a case reference. Free text a person wrote is
 * dropped: a moderator's reason and a case summary are internal, and the
 * delivery log is not the place to keep a second copy of them.
 */
function summarise(message: NotificationMessage): Record<string, unknown> {
  const payload: Record<string, unknown> = { kind: message.kind };

  if ('propertySlug' in message) payload.propertySlug = message.propertySlug;
  if ('reference' in message) payload.reference = message.reference;
  if ('caseId' in message) payload.caseId = message.caseId;

  return payload;
}

/** One line, no identities. `kind` is a constant from the catalogue. */
function report(kind: string, error: unknown): void {
  console.error(
    `[livd] notification "${kind}" could not be dispatched:`,
    error instanceof Error ? error.message : error,
  );
}

export type { NotificationMessage } from './messages';
