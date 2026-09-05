import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Card } from '@/components/ui/primitives';
import { copy } from '@/content/copy';
import { propertyContextLine, propertyDisplayName } from '@/lib/format';
import { requireUserPage } from '@/server/auth/guards';
import { getRepository } from '@/server/data';
import { ClaimForm } from './claim-form';

export const metadata: Metadata = {
  title: copy.property.claim,
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function ClaimPropertyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireUserPage(`/property/${slug}/claim`);

  const repository = await getRepository();
  const property = await repository.getPropertyBySlug(slug);
  if (!property) notFound();

  const existing = await repository.getApprovedClaim(property.id);

  return (
    <div className="container-shell py-12 md:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="font-display text-display-md tracking-display text-ink">
          {copy.property.claim}
        </h1>
        <p className="mt-3 text-body-lg text-ink-muted">
          {propertyDisplayName(property.address)} — {propertyContextLine(property.address)}
        </p>

        <Card className="mt-8 p-6">
          <h2 className="font-display text-title-md tracking-tightish text-ink">
            What claiming does, and what it does not
          </h2>
          <ul className="mt-4 flex flex-col gap-3 text-body text-ink-muted">
            <li className="flex items-start gap-2.5">
              <Marker tone="positive" />
              You can correct factual details about the property.
            </li>
            <li className="flex items-start gap-2.5">
              <Marker tone="positive" />
              You can reply publicly to any review, once per review.
            </li>
            <li className="flex items-start gap-2.5">
              <Marker tone="positive" />
              You can mark an issue a resident raised as resolved.
            </li>
            <li className="flex items-start gap-2.5">
              <Marker tone="critical" />
              You cannot edit, hide, reorder or remove a review. Nothing in Livd&rsquo;s
              database would allow it, whoever asked.
            </li>
            <li className="flex items-start gap-2.5">
              <Marker tone="critical" />
              You cannot review a property you have claimed.
            </li>
          </ul>
        </Card>

        {existing ? (
          <p className="mt-8 rounded-lg border border-caution/30 bg-caution-soft p-5 text-body text-caution">
            This property has already been claimed. If that is wrong, contact us and we will look
            into it.
          </p>
        ) : (
          <ClaimForm propertyId={property.id} />
        )}
      </div>
    </div>
  );
}

function Marker({ tone }: { tone: 'positive' | 'critical' }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`mt-1 size-3.5 shrink-0 ${tone === 'positive' ? 'text-positive' : 'text-critical'}`}
      fill="none"
      aria-hidden="true"
    >
      {tone === 'positive' ? (
        <path
          d="m3 8.4 3 3 7-7"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}
