import type { Metadata } from 'next';
import Link from 'next/link';

import { ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { copy } from '@/content/copy';
import { propertyDisplayName } from '@/lib/format';
import { describeRemaining, editWindowFor } from '@/lib/reviews/edit-window';
import { requireUserPage } from '@/server/auth/guards';
import { getRepository } from '@/server/data';
import { EditReviewForm } from './edit-review-form';

export const metadata: Metadata = {
  title: copy.review.edit.title,
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Correcting a published review.
 *
 * Everything on this page is decided here, on the server, from the stored row:
 * whether this person wrote it, whether it is still published, and how long is
 * left. The form below receives a review that has already passed all three and
 * has no way to ask for one that has not.
 *
 * That is the first of two checks and not the important one. `correctReview`
 * repeats every condition when the form is submitted, and `livd_correct_review`
 * repeats them again against the database's own clock — which is what actually
 * holds when a page has been sitting open since yesterday, or when the request
 * never came from a page at all.
 *
 * A refusal renders as an explanation rather than a 404. Somebody who followed
 * "Edit review" from their own account list and arrived to find the window
 * closed is owed the reason, not a dead end.
 */
export default async function EditReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUserPage(`/account/reviews/${id}/edit`);
  const repository = await getRepository();

  const review = await repository.getReviewById(id);

  // Not found and not yours are one outcome on purpose. Distinguishing them
  // would turn this page into a way to find out which review ids exist.
  if (!review || review.authorId !== user.id) {
    return <Refusal title={copy.review.edit.forbidden} />;
  }

  const property = await repository.getPropertyById(review.propertyId);

  // A server component renders once per request, so "how old is this review
  // right now" has no client render to disagree with. The clock is read inside
  // `editWindowFor`, from the same default the action and the store use.
  const window = editWindowFor(review);

  if (!window.editable) {
    return (
      <Refusal
        title={
          window.reason === 'expired' ? copy.review.edit.closed : copy.review.edit.notPublished
        }
        body={window.reason === 'expired' ? copy.review.edit.closedBody : undefined}
      />
    );
  }

  return (
    <div className="container-shell py-10 md:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <Link
          href="/account/reviews"
          className="rounded-sm text-label text-ink-muted underline underline-offset-4 hover:text-ink"
        >
          {copy.review.edit.cancel}
        </Link>

        <h1 className="mt-5 font-display text-display-md tracking-display text-ink">
          {copy.review.edit.title}
        </h1>
        <p className="mt-3 text-body-lg text-ink-muted">{copy.review.edit.lead}</p>
        {property && (
          <p className="mt-2 text-label text-ink-subtle">
            {propertyDisplayName(property.address)}
          </p>
        )}

        <EditReviewForm
          reviewId={review.id}
          body={review.body ?? ''}
          wouldRecommend={review.wouldRecommend}
          overallRating={review.overallRating}
          categoryRatings={review.categoryRatings}
          residencyStatus={review.residencyStatus}
          tenureMonths={review.tenureMonths}
          verificationLevel={review.verificationLevel}
          // Which extended categories this market suggests. Nobody in London is
          // offered generator reliability by default, and nobody in Lagos has to
          // go looking for it.
          countryCode={property?.address.countryCode ?? null}
          propertySlug={property?.slug ?? null}
          closesAt={window.closesAt}
          remainingLabel={describeRemaining(window.msRemaining)}
        />
      </div>
    </div>
  );
}

function Refusal({ title, body }: { title: string; body?: string }) {
  return (
    <div className="container-shell py-12 md:py-16">
      <Card className="mx-auto w-full max-w-xl p-8">
        <h1 className="font-display text-display-sm tracking-display text-ink">{title}</h1>
        {body && <p className="mt-3 text-body text-ink-muted">{body}</p>}
        <div className="mt-7">
          <ButtonLink href="/account/reviews" variant="secondary">
            {copy.review.edit.cancel}
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
