import { describe, expect, it } from 'vitest';

import {
  ALWAYS_SENT,
  categoryOf,
  renderNotification,
  type NotificationKind,
  type NotificationMessage,
} from '@/server/notify/messages';

/**
 * What Livd's emails may and may not contain.
 *
 * The anonymity rule is the one this file exists for. A property owner is
 * entitled to know a review has been published and to reply to it; they are
 * not entitled to know who wrote it, and an email is the easiest place in a
 * system to leak that by accident, because nobody reviews a template with
 * the threat model in mind.
 *
 * So the catalogue is a closed union whose owner-facing members have no field
 * that could carry a reviewer, and these tests render every message with
 * deliberately identifying values in every field to prove none of them reaches
 * the wrong audience.
 */

/** One of each, filled with values that are obvious if they appear. */
const SAMPLES: Record<NotificationKind, NotificationMessage> = {
  review_published: {
    kind: 'review_published',
    propertyName: 'The Franklin',
    propertySlug: 'the-franklin-brooklyn',
  },
  review_held: { kind: 'review_held', propertyName: 'The Franklin' },
  review_removed: {
    kind: 'review_removed',
    propertyName: 'The Franklin',
    reason: 'Named a member of staff.',
  },
  review_restored: {
    kind: 'review_restored',
    propertyName: 'The Franklin',
    propertySlug: 'the-franklin-brooklyn',
  },
  owner_responded: {
    kind: 'owner_responded',
    propertyName: 'The Franklin',
    propertySlug: 'the-franklin-brooklyn',
  },
  claim_approved: {
    kind: 'claim_approved',
    propertyName: 'The Franklin',
    propertySlug: 'the-franklin-brooklyn',
  },
  claim_rejected: {
    kind: 'claim_rejected',
    propertyName: 'The Franklin',
    reason: 'The documentation did not name the claimant.',
  },
  owner_new_review: {
    kind: 'owner_new_review',
    propertyName: 'The Franklin',
    propertySlug: 'the-franklin-brooklyn',
  },
  account_sanctioned: {
    kind: 'account_sanctioned',
    action: 'suspended',
    reasonLabel: 'Harassment',
    reasonDescription: 'Targeted abuse of another person.',
    endsAt: '2026-09-24T12:00:00.000Z',
  },
  account_sanction_lifted: {
    kind: 'account_sanction_lifted',
    action: 'suspended',
    stillRestricted: false,
  },
  staff_report_opened: {
    kind: 'staff_report_opened',
    propertyName: 'The Franklin',
    reason: 'harassment',
  },
  staff_case_opened: {
    kind: 'staff_case_opened',
    reference: 'LV-1048',
    caseId: 'c-1',
    priority: 'high',
    summary: 'Three reports about one review.',
  },
  staff_authority_request: {
    kind: 'staff_authority_request',
    requestType: 'disclosure',
    authority: 'Metropolitan Police',
  },
  staff_claim_submitted: {
    kind: 'staff_claim_submitted',
    propertyName: 'The Franklin',
    organisation: 'Franklin Residential',
  },
};

const KINDS = Object.keys(SAMPLES) as NotificationKind[];

/** Messages addressed to somebody who owns or manages a property. */
const OWNER_FACING: NotificationKind[] = ['owner_new_review', 'claim_approved', 'claim_rejected'];

describe('the notification catalogue', () => {
  it('renders every kind', () => {
    for (const kind of KINDS) {
      const rendered = renderNotification(SAMPLES[kind]);
      expect(rendered.subject.length, kind).toBeGreaterThan(8);
      expect(rendered.html, kind).toContain('<!doctype html>');
      expect(rendered.text.length, kind).toBeGreaterThan(40);
      expect(categoryOf(kind)).toBeDefined();
    }
  });

  it('never sends a subject longer than a phone shows', () => {
    // Roughly what iOS and Gmail render before truncating. A subject that is
    // cut off is a subject that has not been written.
    for (const kind of KINDS) {
      expect(renderNotification(SAMPLES[kind]).subject.length, kind).toBeLessThanOrEqual(78);
    }
  });

  it('gives every message a plain-text twin', () => {
    for (const kind of KINDS) {
      const { text, html } = renderNotification(SAMPLES[kind]);
      expect(text, kind).not.toContain('<');
      expect(html, kind).toContain('Livd');
    }
  });

  it('says why every email arrived', () => {
    // An unexplained message from a platform is indistinguishable from a
    // phishing attempt, and this is the line that distinguishes it.
    for (const kind of KINDS) {
      expect(renderNotification(SAMPLES[kind]).text, kind).toMatch(/You are getting this because/);
    }
  });

  it('carries no reviewer identity in anything addressed to a property', () => {
    for (const kind of OWNER_FACING) {
      const { html, text, subject } = renderNotification(SAMPLES[kind]);
      const all = `${subject}\n${text}\n${html}`.toLowerCase();

      // The shapes a leak would take. None of these fields exists on an
      // owner-facing message type, so this asserts the type stays that way.
      expect(all, kind).not.toMatch(/@[a-z0-9.-]+\.(com|net|org|co\.uk)/);
      expect(all, kind).not.toMatch(/\breviewer\s+(is|was|name)/);
      expect(all, kind).not.toMatch(/author[_\s-]?id/);
      expect(all, kind).not.toMatch(/wrote by|written by [a-z]/);
    }
  });

  it('tells a property owner plainly that they cannot identify the reviewer', () => {
    const { text } = renderNotification(SAMPLES.owner_new_review);
    expect(text).toMatch(/anonymous/i);
  });

  it('does not offer an opt-out from a decision about your own content', () => {
    // Removal and restoration are not marketing. Somebody who has turned
    // every switch off still learns that their review came down.
    for (const kind of ['review_removed', 'review_restored', 'claim_approved'] as const) {
      expect(renderNotification(SAMPLES[kind]).text, kind).not.toContain(
        'Choose which emails you get',
      );
    }
  });

  it('offers no opt-out from anything the dispatcher always sends', () => {
    for (const kind of ALWAYS_SENT) {
      expect(renderNotification(SAMPLES[kind]).text, kind).not.toContain(
        'Choose which emails you get',
      );
    }
  });

  it('tells a sanctioned person the category, the end date and how to ask again', () => {
    const { subject, text } = renderNotification(SAMPLES.account_sanctioned);

    expect(subject).toBe('Your Livd account has been suspended');
    expect(text).toContain('Harassment');
    expect(text).toContain('24 September 2026');
    expect(text).toMatch(/reply to this email/i);
    // Their published reviews are not what the decision is about.
    expect(text).toMatch(/stay on their property pages/);
  });

  it('never names who applied a sanction, or what anybody reported', () => {
    // The message type has no field for either. This asserts it stays that way.
    const { html, text } = renderNotification(SAMPLES.account_sanctioned);
    const all = `${text}
${html}`.toLowerCase();

    expect(all).not.toMatch(/moderator [a-z]+ (applied|decided)/);
    expect(all).not.toMatch(/report(ed|er)/);
  });

  it('offers an opt-out from the routine ones', () => {
    for (const kind of ['review_published', 'owner_responded', 'owner_new_review'] as const) {
      expect(renderNotification(SAMPLES[kind]).text, kind).toContain('Choose which emails you get');
    }
  });

  it('keeps a held review neutral rather than accusatory', () => {
    const { subject, text } = renderNotification(SAMPLES.review_held);
    const all = `${subject} ${text}`.toLowerCase();

    for (const word of ['violation', 'flagged', 'breach', 'suspicious', 'complaint']) {
      expect(all, word).not.toContain(word);
    }
  });

  it('escapes anything a person typed', () => {
    const { html } = renderNotification({
      kind: 'review_removed',
      propertyName: '<script>alert(1)</script>',
      reason: 'Because "quotes" & <tags>',
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('puts each kind in exactly one preference category', () => {
    const categories = new Set(KINDS.map((kind) => categoryOf(kind)));
    expect([...categories].sort()).toEqual([
      'property_responses',
      'review_updates',
      'trust_safety',
    ]);
  });
});
