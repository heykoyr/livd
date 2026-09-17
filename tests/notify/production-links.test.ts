import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { NotificationKind, NotificationMessage } from '@/server/notify/messages';

/**
 * Where a link in a Livd email points.
 *
 * An email is the one Livd artefact that outlives the request that produced
 * it. It is opened hours later, on a device that has never visited the site,
 * by somebody who cannot see the address bar until they have already tapped.
 * A link built against the wrong origin is therefore not a cosmetic problem
 * the way a wrong canonical tag is — it is a dead end, and in the sign-in
 * case it was one: production magic links pointed at `localhost:3000`.
 *
 * So this renders the entire catalogue against a production-shaped
 * environment and reads every URL out of both the HTML and the text part.
 * Anything not on the canonical origin fails, by construction rather than by
 * a list of forbidden hostnames — a future wrong host nobody has thought of
 * yet fails the same way `localhost` does.
 */

const PRODUCTION_ORIGIN = 'https://livd.site';

/** One of each. The values do not matter here; the hrefs do. */
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

/**
 * The catalogue is rendered through a module whose origin is resolved once at
 * import time, so the environment has to be production-shaped *before* the
 * first import — hence the dynamic import behind a `beforeAll`.
 */
let renderNotification: typeof import('@/server/notify/messages').renderNotification;
let notificationHeaders: typeof import('@/server/notify/shell').notificationHeaders;
let saved: string | undefined;

beforeAll(async () => {
  saved = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = PRODUCTION_ORIGIN;
  vi.resetModules();

  ({ renderNotification } = await import('@/server/notify/messages'));
  ({ notificationHeaders } = await import('@/server/notify/shell'));
});

afterAll(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = saved;
  vi.resetModules();
});

/** Every absolute URL in a blob of HTML or text. */
function urlsIn(content: string): string[] {
  return content.match(/https?:\/\/[^\s"'<>)]+/g) ?? [];
}

describe('links in production email', () => {
  it('finds links to check at all — a vacuous pass would be worse than a failure', () => {
    const found = KINDS.flatMap((kind) => {
      const { html, text } = renderNotification(SAMPLES[kind]);
      return [...urlsIn(html), ...urlsIn(text)];
    });

    expect(found.length).toBeGreaterThan(KINDS.length);
  });

  it('points every link at the canonical origin, in both parts of every message', () => {
    // The bare origin is legitimate — the wordmark at the top of the shell and
    // the footer link both point at the home page with no path.
    const onCanonicalOrigin = (found: string) =>
      found === PRODUCTION_ORIGIN || found.startsWith(`${PRODUCTION_ORIGIN}/`);

    for (const kind of KINDS) {
      const { html, text } = renderNotification(SAMPLES[kind]);

      for (const found of [...urlsIn(html), ...urlsIn(text)]) {
        expect(onCanonicalOrigin(found), `${kind}: ${found}`).toBe(true);
      }
    }
  });

  it('never carries a development, deployment or provider hostname', () => {
    // Belt to the braces above. These are the four that have actually shipped
    // in somebody's production email at some point, here or elsewhere.
    const forbidden = ['localhost', 'vercel.app', 'resend.dev', 'supabase.co'];

    for (const kind of KINDS) {
      const { html, text } = renderNotification(SAMPLES[kind]);

      for (const host of forbidden) {
        expect(html, `${kind} html`).not.toContain(host);
        expect(text, `${kind} text`).not.toContain(host);
      }
    }
  });

  it('sends people to HTTPS, so a tapped link is never downgraded', () => {
    for (const kind of KINDS) {
      const { html, text } = renderNotification(SAMPLES[kind]);

      for (const found of [...urlsIn(html), ...urlsIn(text)]) {
        expect(found.startsWith('https://'), `${kind}: ${found}`).toBe(true);
      }
    }
  });

  it('puts the canonical origin in the List-Unsubscribe header too', () => {
    // A mail client reads this one, not a person. It is the easiest link in
    // the message to leave pointing at the old host, because nothing renders it.
    const header = notificationHeaders()['List-Unsubscribe'];

    expect(header).toBe(`<${PRODUCTION_ORIGIN}/account/notifications>`);
  });
});
