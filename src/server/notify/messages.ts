import 'server-only';

import { SITE } from '@/config/site';
import { renderEmail } from './shell';

/**
 * Everything Livd will send, and nothing else.
 *
 * A closed union rather than a `sendEmail(subject, body)` helper, for two
 * reasons that are really the same reason. The first is that it makes the
 * notification matrix readable in one file: what is sent, to whom, under which
 * preference, with what words. The second is that it makes the anonymity rule
 * checkable — a message addressed to a property owner cannot mention a
 * reviewer, because its payload type has no field that could carry one.
 *
 * `tests/notify/messages.test.ts` reads this catalogue and asserts that
 * property against every message, so a field added later fails the suite
 * rather than a person's trust.
 *
 * VOICE
 *
 * The same as the product: plain, exact, unhurried, sentence case, no
 * exclamation marks. A moderation email in particular is read by somebody who
 * is already anxious, so it says what happened and what they can do, and it
 * does not editorialise about why.
 */

/** Which switch on the preferences page governs a message. */
export type NotificationCategory = 'review_updates' | 'property_responses' | 'trust_safety';

export type NotificationMessage =
  /* ---- To the person who wrote a review ---------------------------- */
  | { kind: 'review_published'; propertyName: string; propertySlug: string }
  | { kind: 'review_held'; propertyName: string }
  | { kind: 'review_removed'; propertyName: string; reason: string }
  | { kind: 'review_restored'; propertyName: string; propertySlug: string }
  | { kind: 'owner_responded'; propertyName: string; propertySlug: string }

  /* ---- To an approved property claimant ----------------------------- */
  | { kind: 'claim_approved'; propertyName: string; propertySlug: string }
  | { kind: 'claim_rejected'; propertyName: string; reason: string }
  | { kind: 'owner_new_review'; propertyName: string; propertySlug: string }

  /* ---- To staff ------------------------------------------------------ */
  | { kind: 'staff_report_opened'; propertyName: string; reason: string }
  | { kind: 'staff_case_opened'; reference: string; caseId: string; priority: string; summary: string }
  | { kind: 'staff_authority_request'; requestType: string; authority: string }
  | { kind: 'staff_claim_submitted'; propertyName: string; organisation: string | null };

export type NotificationKind = NotificationMessage['kind'];

export interface RenderedNotification {
  subject: string;
  html: string;
  text: string;
  category: NotificationCategory;
}

function url(path: string): string {
  return `${SITE.url}${path}`;
}

/**
 * Which preference governs which message.
 *
 * Staff mail is `trust_safety` so that it is at least *nameable*, but the
 * dispatcher does not consult a preference for a role fan-out — operational
 * notification follows the role, and somebody who does not want it should
 * hand the role back.
 */
const CATEGORY: Record<NotificationKind, NotificationCategory> = {
  review_published: 'review_updates',
  review_held: 'review_updates',
  review_removed: 'review_updates',
  review_restored: 'review_updates',
  owner_responded: 'property_responses',
  claim_approved: 'trust_safety',
  claim_rejected: 'trust_safety',
  owner_new_review: 'property_responses',
  staff_report_opened: 'trust_safety',
  staff_case_opened: 'trust_safety',
  staff_authority_request: 'trust_safety',
  staff_claim_submitted: 'trust_safety',
};

export function categoryOf(kind: NotificationKind): NotificationCategory {
  return CATEGORY[kind];
}

export function renderNotification(message: NotificationMessage): RenderedNotification {
  const category = CATEGORY[message.kind];

  switch (message.kind) {
    /* ------------------------------------------------------------------
     * The reviewer
     * --------------------------------------------------------------- */

    case 'review_published':
      return {
        category,
        subject: 'Your Livd review is now live',
        ...renderEmail({
          heading: 'Your review is live',
          paragraphs: [
            `What you wrote about ${message.propertyName} is now on its property page, where the next person looking at that building will read it.`,
            'Your name is not shown, and nothing on the page identifies you.',
          ],
          action: { label: 'See your review', href: url(`/property/${message.propertySlug}#reviews`) },
          why: 'You are getting this because you published a review on Livd.',
          managePreferences: true,
        }),
      };

    case 'review_held':
      // Neutral. A held review is not an accusation, and a person told "your
      // review has been flagged" reads it as one. What they need is the fact
      // and the timescale.
      return {
        category,
        subject: 'Your Livd review is being checked',
        ...renderEmail({
          heading: 'We are reading your review first',
          paragraphs: [
            `Your review of ${message.propertyName} has not been published yet. Reviews that describe something serious are read by a person before they go up — that is a standing rule about the subject matter, not a judgement about what you wrote.`,
            'Nothing is required from you. You will get another email when it is decided, usually within a couple of days.',
          ],
          action: { label: 'Your reviews', href: url('/account/reviews') },
          why: 'You are getting this because you submitted a review on Livd.',
          managePreferences: true,
        }),
      };

    case 'review_removed':
      return {
        category,
        subject: 'Your Livd review has been removed',
        ...renderEmail({
          heading: 'Your review is no longer public',
          paragraphs: [
            `Your review of ${message.propertyName} has been taken off the property page after a moderator read it.`,
            `The reason recorded was: ${message.reason}`,
            'If you think that is wrong, reply to this email and a person will look at it again. You can also write a new review of the same tenancy that stays within the content policy.',
          ],
          action: { label: 'Content policy', href: url('/legal/content-policy') },
          why: 'You are getting this because it concerns a review you wrote.',
          // A decision about your own content is not something to opt out of.
          managePreferences: false,
        }),
      };

    case 'review_restored':
      return {
        category,
        subject: 'Your Livd review is back on the property page',
        ...renderEmail({
          heading: 'Your review has been restored',
          paragraphs: [
            `Your review of ${message.propertyName} is public again. It counts towards the property's score as it did before.`,
          ],
          action: { label: 'See your review', href: url(`/property/${message.propertySlug}#reviews`) },
          why: 'You are getting this because it concerns a review you wrote.',
          managePreferences: false,
        }),
      };

    case 'owner_responded':
      return {
        category,
        subject: 'The property has responded to your Livd review',
        ...renderEmail({
          heading: 'A response to your review',
          paragraphs: [
            `Whoever manages ${message.propertyName} has posted a public reply to your review. It appears underneath what you wrote, labelled as a property response.`,
            'They cannot see who you are. Claiming a property gives a right of reply and nothing else — it does not let anyone edit, hide or remove what you wrote.',
          ],
          action: { label: 'Read the response', href: url(`/property/${message.propertySlug}#reviews`) },
          why: 'You are getting this because somebody responded to a review you wrote.',
          managePreferences: true,
        }),
      };

    /* ------------------------------------------------------------------
     * The property owner
     *
     * Nothing in these carries a reviewer's identity, and the payload types
     * above have no field that could.
     * --------------------------------------------------------------- */

    case 'claim_approved':
      return {
        category,
        subject: 'Your Livd property claim has been approved',
        ...renderEmail({
          heading: 'You can now respond on this property',
          paragraphs: [
            `Your claim on ${message.propertyName} has been approved. You can post one public response to each review of it, and correct factual details about the building.`,
            'You cannot edit, hide or remove a resident review, and you will never be shown who wrote one. That is the arrangement residents were promised, and it is what makes a response worth reading.',
          ],
          action: { label: 'Go to the property', href: url(`/property/${message.propertySlug}`) },
          why: 'You are getting this because you claimed a property on Livd.',
          managePreferences: false,
        }),
      };

    case 'claim_rejected':
      return {
        category,
        subject: 'Your Livd property claim was not approved',
        ...renderEmail({
          heading: 'We could not approve your claim',
          paragraphs: [
            `Your claim on ${message.propertyName} has not been approved.`,
            `The reason recorded was: ${message.reason}`,
            'If you can supply something that settles it, reply to this email and a person will look again.',
          ],
          why: 'You are getting this because you submitted a property claim on Livd.',
          managePreferences: false,
        }),
      };

    case 'owner_new_review':
      return {
        category,
        subject: 'A new resident review has been published for your property',
        ...renderEmail({
          heading: 'A new review of your property',
          paragraphs: [
            `Somebody who lived at ${message.propertyName} has published a review. It is on the property page now.`,
            'You can post one public response to it. Residents write to Livd anonymously, so you will not be told who they are — a response that engages with what was said is worth more than one that tries to work out who said it.',
          ],
          action: { label: 'Read it and respond', href: url(`/property/${message.propertySlug}#reviews`) },
          why: 'You are getting this because you have an approved claim on this property.',
          managePreferences: true,
        }),
      };

    /* ------------------------------------------------------------------
     * Staff
     *
     * Short. These are read on a phone by somebody deciding whether to open
     * a laptop, so the useful content is the subject line and one sentence.
     * --------------------------------------------------------------- */

    case 'staff_report_opened':
      return {
        category,
        subject: 'Livd — a review has been reported',
        ...renderEmail({
          heading: 'A review has been reported',
          paragraphs: [
            `A report has been filed about a review of ${message.propertyName}. Reason given: ${message.reason}.`,
            'A report does nothing to the review on its own. It is waiting for somebody to look at it.',
          ],
          action: { label: 'Open the reports queue', href: url('/admin/reports') },
          why: 'You are getting this because you moderate on Livd.',
          managePreferences: false,
        }),
      };

    case 'staff_case_opened':
      return {
        category,
        subject: `Livd — ${message.priority} priority case ${message.reference}`,
        ...renderEmail({
          heading: `Case ${message.reference} needs an owner`,
          paragraphs: [
            `A ${message.priority}-priority case has been opened: ${message.summary}`,
            'Nothing has been done to the content it concerns. Opening a case is not a decision about it.',
          ],
          action: { label: 'Open the case', href: url(`/admin/cases/${message.caseId}`) },
          why: 'You are getting this because you handle Trust & Safety on Livd.',
          managePreferences: false,
        }),
      };

    case 'staff_authority_request':
      return {
        category,
        subject: 'Livd — an authority request needs a decision',
        ...renderEmail({
          heading: 'An authority request is waiting',
          paragraphs: [
            `A ${message.requestType} request has been recorded from ${message.authority}.`,
            'Nothing is disclosed until somebody decides it should be, and the decision is recorded with its reason.',
          ],
          action: { label: 'Open authority requests', href: url('/admin/authority-requests') },
          why: 'You are getting this because you handle Trust & Safety on Livd.',
          managePreferences: false,
        }),
      };

    case 'staff_claim_submitted':
      return {
        category,
        subject: 'Livd — a property claim is waiting',
        ...renderEmail({
          heading: 'A property claim is waiting',
          paragraphs: [
            `Somebody has claimed ${message.propertyName}${
              message.organisation ? `, on behalf of ${message.organisation}` : ''
            }.`,
            'Approving it hands a commercial party a standing right of reply on that property page, so it needs a written reason either way.',
          ],
          action: { label: 'Open property claims', href: url('/admin/claims') },
          why: 'You are getting this because you moderate on Livd.',
          managePreferences: false,
        }),
      };
  }
}
