'use server';

import * as admin from '@/server/admin';
import type { EmailDeliveryTestState } from './action-state';

/**
 * The email delivery check.
 *
 * A thin adapter. Authentication, the administrator tier, the rate limit, the
 * recipient and the audit entry are all decided inside `sendDeliveryTest` —
 * this is a separate entry point reachable by a direct POST, so nothing about
 * the page that renders the button can be relied on to have checked anything.
 */
export async function runEmailDeliveryTest(
  _previous: EmailDeliveryTestState,
  formData: FormData,
): Promise<EmailDeliveryTestState> {
  const result = await admin.sendDeliveryTest({ kind: formData.get('kind') ?? 'all' });

  if (!result.ok) return { error: result.error, report: null };
  return { error: null, report: result.data };
}
