import Link from 'next/link';

import { Card, EmptyState } from '@/components/ui/primitives';
import { formatRelativeTime, propertyContextLine, propertyDisplayName } from '@/lib/format';
import { getRepository } from '@/server/data';
import { ClaimControls } from '../moderation-controls';

/**
 * Ownership claims.
 *
 * Approving a claim grants a right of reply and the ability to correct factual
 * details. It grants nothing over the reviews themselves — no schema column and
 * no RLS policy would allow it.
 */
export default async function ClaimsPage() {
  const repository = await getRepository();
  const claims = await repository.listClaims('pending');

  if (claims.length === 0) {
    return (
      <EmptyState
        title="No claims waiting"
        description="When an owner or managing agent claims a property, their request appears here for a decision."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-5">
      {claims.map(({ claim, property }) => (
        <li key={claim.id}>
          <Card className="p-6">
            <Link
              href={`/property/${property.slug}`}
              className="font-display text-title-md tracking-tightish text-ink hover:underline"
            >
              {propertyDisplayName(property.address)}
            </Link>
            <p className="mt-1 text-label text-ink-muted">
              {propertyContextLine(property.address)}
            </p>

            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                  Claimed role
                </dt>
                <dd className="mt-1 text-body capitalize text-ink">{claim.roleClaimed}</dd>
              </div>
              <div>
                <dt className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                  Organisation
                </dt>
                <dd className="mt-1 text-body text-ink">{claim.organisation ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                  Contact
                </dt>
                <dd className="mt-1 break-all text-body text-ink">{claim.contactEmail}</dd>
              </div>
            </dl>

            <p className="mt-4 text-micro text-ink-subtle">
              Submitted {formatRelativeTime(claim.createdAt)}
            </p>

            <div className="mt-5 border-t border-border pt-5">
              <ClaimControls claimId={claim.id} />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
