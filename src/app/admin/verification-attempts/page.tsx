import Link from 'next/link';

import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { formatRelativeTime, propertyContextLine, propertyDisplayName } from '@/lib/format';
import { getRepository } from '@/server/data';
import type { PropertyVerificationFailureReason } from '@/types/domain';

/**
 * Location verification attempts.
 *
 * What a moderator needs in order to investigate abuse, and deliberately not a
 * metre more. This page can answer:
 *
 *   which account, which property, which method, what was decided, when
 *
 * and it cannot answer "where was this person", because the row it reads from
 * does not contain that and neither does any other row in the database. There
 * is no location to expose to an ordinary moderator, so there is no question of
 * whether one should be.
 *
 * The account is identified by its id and nothing else. A moderator following a
 * pattern needs to know that forty attempts came from the same account; they do
 * not need an email address to establish it, and Livd does not put one here.
 *
 * Note also who cannot reach this page. It sits under the admin layout's
 * moderator guard, and `property_verifications` grants select to moderators and
 * to the row's own subject — an approved property claimant has no policy at all
 * on that table, so "who verified themselves at my building" is a question the
 * schema cannot answer for an owner however they ask it.
 */

const FAILURE_LABELS: Record<PropertyVerificationFailureReason, string> = {
  property_has_no_coordinates: 'Property has no coordinates',
  invalid_position: 'Position was not usable',
  accuracy_too_low: 'Reading was too vague',
  fix_too_old: 'Reading was stale',
  outside_area: 'Outside the verification area',
  implausible_movement: 'Implausibly far from the last check',
};

export default async function VerificationAttemptsPage() {
  const repository = await getRepository();
  const attempts = await repository.listRecentVerificationAttempts(60);

  if (attempts.length === 0) {
    return (
      <EmptyState
        title="No verification attempts yet"
        description="Every location check a resident makes is recorded here — the decision, never the position it was made from."
      />
    );
  }

  // A count per account, so a pattern is visible without reading sixty rows.
  const attemptsByUser = new Map<string, { total: number; failed: number }>();
  for (const { verification } of attempts) {
    const entry = attemptsByUser.get(verification.userId) ?? { total: 0, failed: 0 };
    entry.total += 1;
    if (verification.status === 'failed') entry.failed += 1;
    attemptsByUser.set(verification.userId, entry);
  }

  const repeated = [...attemptsByUser.entries()]
    .filter(([, counts]) => counts.total >= 5)
    .sort((a, b) => b[1].total - a[1].total);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="font-display text-title-lg tracking-tightish text-ink">
          Recent location checks
        </h2>
        <p className="mt-1 max-w-prose text-label text-ink-muted">
          The last {attempts.length} attempts across all accounts. Livd records that a check
          happened and what it decided. It does not record where anyone was, so this page cannot
          show you and nor can the database.
        </p>
      </div>

      {repeated.length > 0 && (
        <Card className="border-caution/30 bg-caution-soft/40 p-5">
          <h3 className="text-label font-semibold text-ink">Accounts with repeated attempts</h3>
          <ul className="mt-3 flex flex-col gap-1.5">
            {repeated.map(([userId, counts]) => (
              <li key={userId} className="text-label text-ink-muted">
                <span className="font-mono text-micro text-ink">{userId}</span> — {counts.total}{' '}
                attempts, {counts.failed} failed
              </li>
            ))}
          </ul>
          <p className="mt-3 text-micro text-ink-subtle">
            Repetition on its own is not misconduct: a resident with a poor signal legitimately
            tries several times. What is worth a second look is many attempts across many
            different properties.
          </p>
        </Card>
      )}

      <ul className="flex flex-col gap-3">
        {attempts.map(({ verification, property }) => (
          <li key={verification.id}>
            <Card className="p-4 md:p-5">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={verification.status === 'verified' ? 'positive' : 'neutral'}>
                      {verification.status === 'verified' ? 'Verified' : 'Failed'}
                    </Badge>
                    <Badge tone="info">{verification.method}</Badge>
                    {verification.failureReason === 'implausible_movement' && (
                      <Badge tone="critical">Look at this</Badge>
                    )}
                  </div>

                  <p className="mt-2.5 min-w-0 truncate font-medium text-ink">
                    <Link href={`/property/${property.slug}`} className="hover:underline">
                      {propertyDisplayName(property.address)}
                    </Link>
                  </p>
                  <p className="mt-0.5 truncate text-label text-ink-muted">
                    {propertyContextLine(property.address)}
                  </p>
                  {verification.failureReason && (
                    <p className="mt-1.5 text-label text-ink-muted">
                      {FAILURE_LABELS[verification.failureReason]}
                    </p>
                  )}
                </div>

                <div className="shrink-0 text-right">
                  <p className="font-mono text-micro text-ink-subtle">{verification.userId}</p>
                  <p className="mt-1 text-label text-ink-subtle">
                    {formatRelativeTime(verification.createdAt)}
                  </p>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
