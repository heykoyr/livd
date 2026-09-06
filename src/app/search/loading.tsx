import { PropertyCardSkeleton } from '@/components/property/property-card';
import { copy } from '@/content/copy';

/**
 * Search loading state.
 *
 * Skeleton cards in the exact shape of the real ones, so the layout does not
 * jump when results arrive. The live region announces the wait to a screen
 * reader, which otherwise gets silence.
 */
export default function SearchLoading() {
  return (
    <div className="container-shell py-10 md:py-14">
      <div className="h-11 w-72 rounded-md bg-surface-sunken" />
      <div className="mt-6 h-11 max-w-2xl rounded-lg bg-surface-sunken" />

      <div className="mt-6 flex items-center justify-between border-t border-border pt-5">
        <div className="h-4 w-28 rounded-md bg-surface-sunken" />
        <div className="h-9 w-40 rounded-md bg-surface-sunken" />
      </div>

      <p role="status" className="sr-only">
        {copy.search.searching}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <PropertyCardSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}
