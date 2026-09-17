import 'server-only';

import { z } from 'zod';

import { propertyDisplayName } from '@/lib/format';
import { checkRateLimit } from '@/lib/safety/rate-limit';
import {
  renderNotification,
  type NotificationKind,
  type NotificationMessage,
} from '@/server/notify/messages';
import { notificationHeaders } from '@/server/notify/shell';
import { hasMailProvider, recipientDomain, sendEmail } from '@/server/notify/transport';
import type { LivdRepository } from '@/server/data';
import { refused } from './errors';
import { runAdminAction, type AdminResult } from './run';

/**
 * The email delivery check.
 *
 * Sends every message in the catalogue, rendered and transported exactly as
 * production sends it, to the administrator who asked — and to nobody else.
 *
 * WHY THIS EXISTS RATHER THAN A SCRIPT
 *
 * The honest way to test "does the owner-response email arrive, from Livd,
 * with links on livd.site" is to send one through the deployment that will
 * send the real ones: its API key, its From identity, its resolved origin, its
 * runtime. A script on a laptop tests a laptop. And the only other way to make
 * production send an owner-response email is to post an owner response — on a
 * real property, in public, on a product with no delete path by design.
 * Fabricating reviews and responses on a live site to test email is not a
 * test plan. This is.
 *
 * WHAT IT DOES NOT DO
 *
 * - **It does not take a recipient.** The address is the signed-in actor's,
 *   read from the session. There is no field in the schema that could carry
 *   another one, so this cannot be turned into a relay that mails strangers
 *   from a verified domain — the thing a spammer would most want from it.
 * - **It does not touch the notification ledger.** A test send claims no
 *   dedupe key, so it cannot suppress a real notification later, and the
 *   ledger stays a record of real events only.
 * - **It does not consult preferences.** The point is to see every message.
 *
 * Subjects carry a `[Test]` prefix and an `X-Livd-Test` header. Everything
 * else — From, Reply-To, body, links, List-Unsubscribe — is byte-for-byte what
 * a real send carries, which is the whole value of the exercise. The prefix is
 * there because an administrator who receives "A new review of your property"
 * about a building they do not own deserves to know at a glance why.
 */

/** Every kind, in catalogue order — the order the results are shown in. */
export const DELIVERY_TEST_KINDS = [
  'review_published',
  'review_held',
  'review_removed',
  'review_restored',
  'owner_responded',
  'claim_approved',
  'claim_rejected',
  'owner_new_review',
  'staff_report_opened',
  'staff_case_opened',
  'staff_authority_request',
  'staff_claim_submitted',
] as const satisfies readonly NotificationKind[];

export interface DeliveryTestResult {
  kind: NotificationKind;
  subject: string;
  ok: boolean;
  /** `console` means nothing left the server: this deployment has no key. */
  provider: 'resend' | 'console';
  /** The provider's message id, for finding it in the Resend dashboard. */
  id: string | null;
  error: string | null;
}

export interface DeliveryTestReport {
  /** Masked. The page already knows who is signed in; the log does not need to. */
  recipientDomain: string;
  providerConfigured: boolean;
  results: DeliveryTestResult[];
}

const schema = z.object({
  kind: z.enum(['all', ...DELIVERY_TEST_KINDS]).default('all'),
});

/**
 * The provider's per-second ceiling, with room. Resend refuses bursts above a
 * few requests a second with a 429, and twelve back-to-back sends would read
 * as "half the catalogue is broken" when nothing is.
 *
 * Applied only when a provider is actually being called. With no key there is
 * no ceiling to respect, and seven seconds of sleeping would buy nothing.
 */
const PACE_MS = 600;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Real destinations where there are some.
 *
 * A link to `/property/example` in a test email proves nothing: it 404s, and
 * "did the link work" is one of the things being checked. So the property and
 * case links point at a real public property and a real case when the
 * database has them. Reads only, and nothing here is written anywhere.
 */
async function destinations(
  repository: LivdRepository,
): Promise<{ propertyName: string; propertySlug: string; caseId: string; caseReference: string }> {
  let propertyName = 'Example Residences';
  let propertySlug = 'example-residences';
  let caseId = '00000000-0000-0000-0000-000000000000';
  let caseReference = 'LV-TEST';

  try {
    const results = await repository.searchProperties({
      query: '',
      countryCode: null,
      locality: null,
      propertyTypes: [],
      minScore: null,
      minReviews: null,
      verifiedOnly: false,
      sort: 'reviews_desc',
      page: 1,
    });
    const real = results.items.find((summary) => !summary.property.isDemo) ?? results.items[0];
    if (real) {
      propertyName = propertyDisplayName(real.property.address);
      propertySlug = real.property.slug;
    }
  } catch {
    // A placeholder link is a worse test, not a failed one.
  }

  try {
    const cases = await repository.listCases({ page: 1, pageSize: 1 });
    const latest = cases.items[0];
    if (latest) {
      caseId = latest.id;
      caseReference = latest.reference;
    }
  } catch {
    // As above.
  }

  return { propertyName, propertySlug, caseId, caseReference };
}

function samples(
  where: Awaited<ReturnType<typeof destinations>>,
): Record<NotificationKind, NotificationMessage> {
  const { propertyName, propertySlug, caseId, caseReference } = where;

  return {
    review_published: { kind: 'review_published', propertyName, propertySlug },
    review_held: { kind: 'review_held', propertyName },
    review_removed: {
      kind: 'review_removed',
      propertyName,
      reason: 'This is a delivery check. No review was removed.',
    },
    review_restored: { kind: 'review_restored', propertyName, propertySlug },
    owner_responded: { kind: 'owner_responded', propertyName, propertySlug },
    claim_approved: { kind: 'claim_approved', propertyName, propertySlug },
    claim_rejected: {
      kind: 'claim_rejected',
      propertyName,
      reason: 'This is a delivery check. No claim was decided.',
    },
    owner_new_review: { kind: 'owner_new_review', propertyName, propertySlug },
    staff_report_opened: {
      kind: 'staff_report_opened',
      propertyName,
      reason: 'delivery check',
    },
    staff_case_opened: {
      kind: 'staff_case_opened',
      reference: caseReference,
      caseId,
      priority: 'medium',
      summary: 'This is a delivery check. No case was opened.',
    },
    staff_authority_request: {
      kind: 'staff_authority_request',
      requestType: 'delivery check',
      authority: 'Livd',
    },
    staff_claim_submitted: {
      kind: 'staff_claim_submitted',
      propertyName,
      organisation: null,
    },
  };
}

export async function sendDeliveryTest(raw: unknown): Promise<AdminResult<DeliveryTestReport>> {
  return runAdminAction(
    {
      action: 'email_delivery_tested',
      // The top rank, and not because the act is dangerous. It sends staff
      // messages, including a Trust & Safety escalation, and whoever runs it
      // should be somebody entitled to receive every one of them.
      requires: 'admin',
      schema,
      subject: () => ({ type: 'user', id: null }),
      detail: (input, output) => ({
        kind: input.kind,
        provider: output ? (output.providerConfigured ? 'resend' : 'console') : null,
        sent: output ? output.results.filter((r) => r.ok).length : null,
        failed: output ? output.results.filter((r) => !r.ok).length : null,
        recipientDomain: output?.recipientDomain ?? null,
      }),
      run: async ({ actor, repository }, input) => {
        const limit = await checkRateLimit('emailDeliveryTest', `user:${actor.id}`);
        if (!limit.allowed) {
          throw refused('The delivery check has been run three times this hour. Try again later.');
        }

        // From the session, never from the input. See the header.
        const recipient = actor.email;
        if (!recipient || !recipient.includes('@')) {
          throw refused('Your account has no email address to send the check to.');
        }

        const messages = samples(await destinations(repository));
        const kinds = input.kind === 'all' ? [...DELIVERY_TEST_KINDS] : [input.kind];

        const headers = { ...notificationHeaders(), 'X-Livd-Test': 'delivery-check' };
        const pacing = hasMailProvider();
        const results: DeliveryTestResult[] = [];

        for (const [index, kind] of kinds.entries()) {
          if (index > 0 && pacing) await pause(PACE_MS);

          const rendered = renderNotification(messages[kind]);
          const subject = `[Test] ${rendered.subject}`;

          const sent = await sendEmail({
            to: recipient,
            subject,
            html: rendered.html,
            text: rendered.text,
            headers,
          });

          results.push({
            kind,
            subject,
            ok: sent.ok,
            provider: sent.provider,
            id: sent.ok ? sent.id : null,
            error: sent.ok ? null : sent.error,
          });
        }

        return {
          recipientDomain: recipientDomain(recipient),
          providerConfigured: hasMailProvider(),
          results,
        };
      },
    },
    raw,
  );
}
