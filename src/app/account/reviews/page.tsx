import type { Metadata } from 'next';
import Link from 'next/link';

import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { LIMITS } from '@/config/site';
import { copy } from '@/content/copy';
import { formatRelativeTime, formatTenure, propertyDisplayName } from '@/lib/format';
import { requireUserPage } from '@/server/auth/guards';
import { VerifyResidency } from '@/components/property/verify-residency';
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

  return (
    <div className="container-shell py-12 md:py-16">
      <h1 className="font-display text-display-lg tracking-display text-ink">
        {copy.account.myReviews}
      </h1>

      <ul className="mt-10 flex flex-col gap-4">
        {reviews.map((review, index) => {
          const property = properties[index];
          // A server component, rendered once per request: "how old is this
          // review right now" is exactly the question the edit window asks,
          // and there is no client render for it to be inconsistent with.
          // eslint-disable-next-line react-hooks/purity
          const ageHours = (Date.now() - new Date(review.createdAt).getTime()) / 3_600_000;
          const editable =
            review.status === 'published' && ageHours <= LIMITS.reviewEditWindowHours;

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

                <p className="mt-4 border-t border-border pt-3 text-micro text-ink-subtle">
                  {editable
                    ? copy.review.editWindow(
                        Math.max(1, Math.round(LIMITS.reviewEditWindowHours - ageHours)),
                      )
                    : review.status === 'removed'
                      ? 'A moderator removed this review.'
                      : 'This review is now part of the property’s permanent record and can no longer be edited.'}
                </p>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
