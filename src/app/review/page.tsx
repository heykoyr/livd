import type { Metadata } from 'next';

import { copy } from '@/content/copy';
import { requireUserPage } from '@/server/auth/guards';
import { resolvePropertyBySlug } from '@/server/actions/property-lookup';
import { ReviewWizard } from './review-wizard';

export const metadata: Metadata = {
  title: copy.review.title,
  description: copy.review.lead,
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; new?: string; existing?: string }>;
}) {
  const params = await searchParams;

  // Authentication is required to write, but only here — the whole product is
  // readable without an account, and the sign-in returns to this exact page.
  const returnTo = params.property ? `/review?property=${params.property}` : '/review';
  await requireUserPage(returnTo);

  const property = params.property ? await resolvePropertyBySlug(params.property) : null;

  const notice = params.new
    ? 'Property added. You can review it now.'
    : params.existing
      ? 'That property was already on Livd, so we have taken you to it.'
      : null;

  return (
    <div className="container-shell py-10 md:py-16">
      <ReviewWizard
        initialProperty={property}
        propertyPreselected={property !== null}
        notice={notice}
      />
    </div>
  );
}
