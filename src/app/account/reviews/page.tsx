import type { Metadata } from 'next';
import Link from 'next/link';

import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { copy } from '@/content/copy';
import { formatRelativeTime, formatTenure, propertyDisplayName } from '@/lib/format';
import { describeRemaining, editWindowFor } from '@/lib/reviews/edit-window';
import { requireUserPage } from '@/server/auth/guards';
import { VerifyResidency } from '@/components/property/verify-residency';
import { VerificationBadge } from '@/components/property/verify-location';
import { getRepository } from '@/server/data';
import type { ReviewStatus } from '@/types/domain';

export const metadata: Metadata = {
  title: copy.account.myReviews,
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<ReviewStatus, string> = {
  published: 'Published',
  pending_moderation: 'With a moderator',
  held: 'Held',
  removed: 'Removed',
};

/**
 * My reviews.
 *
 * Shows the edit window explicitly rather than letting it expire silently. A
 * review becomes part of a property's permanent record after 24 hours, and
 * someone is entitled to know that while they can still act on it.
 *
 * For most of this product's life the page said exactly that and stopped there.
 * It printed "you can correct this review for the next 21 hours" and offered no
 * way to — the database had permitted the edit since migration 0004, and
 * nothing above it ever called. A promise with no control under it is worse
 * than no promise, so the sentence now comes with the action it describes.
 */
export default async function MyReviewsPage() {
  const user = await requireUserPage('/account/reviews');
  const repository = await getRepository();

  const reviews = await repository.listReviewsByAuthor(user.id);

  if (reviews.length === 0) {
    return (
      <div className="container-shell py-12 md:py-16">
        <h1 className="font-display text-display-lg tracking-display text-ink">
          {copy.account.myReviews}
        </h1>
        <EmptyState
          className="mt-10"
          title={copy.account.myReviewsEmpty}
          description="Every property page on Livd exists because somebody wrote the first one. If you have rented anywhere in the last few years, you know something the next person does not."
          action={
            <ButtonLink href="/review" size="lg">
              {copy.nav.writeReview}
            </ButtonLink>
          }
        />
      </div>
    );
  }

  const [properties, verifications] = await Promise.all([
    Promise.all(reviews.map((review) => repository.getPropertyById(review.propertyId))),
    Promise.all(reviews.map((review) => repository.listVerificationsForReview(review.id))),
  ]);

  // One clock for the whole list, read once. Two reviews written a second apart
  // must not be measured against two different "nows".
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <div className="container-shell py-12 md:py-16">
      <h1 className="font-display text-display-lg tracking-display text-ink">
        {copy.account.myReviews}
      </h1>

      <ul className="mt-10 flex flex-col gap-4">
        {reviews.map((review, index) => {
          const property = properties[index];
          const window = editWindowFor(review, now);

          return (
            <li key={review.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    {property ? (
                      <Link
                        href={`/property/${property.slug}`}
                        className="font-display text-title-md tracking-tightish text-ink hover:underline"
                      >
                        {propertyDisplayName(property.address)}
                      </Link>
                    ) : (
                      <span className="font-display text-title-md text-ink-subtle">
                        Property unavailable
                      </span>
                    )}
                    <p className="mt-1 text-label text-ink-muted">
                      {formatTenure(review.tenureMonths)} · written{' '}
                      {formatRelativeTime(review.createdAt)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <Badge
                      tone={
                        review.status === 'published'
                          ? 'positive'
                          : review.status === 'removed'
                            ? 'critical'
                            : 'caution'
                      }
                    >
                      {STATUS_LABEL[review.status]}
                    </Badge>
                    {/* Their own review, so the level it carries is shown
                        plainly. Still no timestamp: "verified 7 September at
                        4:13pm" is a record of where somebody was at a moment,
                        and it is no more theirs to be shown than anyone's. */}
                    <VerificationBadge level={review.verificationLevel} />
                    <span className="text-title-md tabular text-ink">
                      {review.overallRating}/5
                    </span>
                  </div>
                </div>

                {review.body && (
                  <p className="prose-measure mt-4 whitespace-pre-line text-body text-ink-muted">
                    {review.body}
                  </p>
                )}

                {review.status === 'published' && (
                  <VerifyResidency
                    reviewId={review.id}
                    outcome={verifications[index]?.[0]?.outcome ?? null}
                  />
                )}

                {/*
                  The action and the sentence that explains it, on one line. A
                  secondary button rather than the page's loudest control:
                  correcting a review is a thing a few people need and nobody
                  came here to be sold, and the card already carries a link to
                  the property and a verification prompt.

                  Wraps to two rows under about 380px, with the button first, so
                  the tappable thing is never the part that falls off the
                  bottom.
                */}
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3">
                  {window.editable && (
                    <ButtonLink
                      href={`/account/reviews/${review.id}/edit`}
                      variant="secondary"
                      size="sm"
                    >
                      {copy.review.edit.action}
                    </ButtonLink>
                  )}
                  <p className="text-micro text-ink-subtle">
                    {window.editable
                      ? copy.review.edit.remaining(describeRemaining(window.msRemaining))
                      : review.status === 'removed'
                        ? copy.account.reviewRemoved
                        : review.status === 'published'
                          ? copy.account.reviewPermanent
                          : copy.account.reviewWithModerator}
                  </p>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
