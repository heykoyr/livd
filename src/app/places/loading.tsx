import { PropertyCardSkeleton } from '@/components/property/property-card';
import { copy } from '@/content/copy';

/**
 * Explore loading state.
 *
 * The same shapes in the same places as the real page, so nothing jumps when
 * the sections arrive. The live region announces the wait, which a screen
 * reader otherwise spends in silence.
 */
export default function ExploreLoading() {
  return (
    <>
      <div className="border-b border-border bg-surface">
        <div className="container-shell py-12 md:py-16" aria-hidden="true">
          <div className="max-w-3xl">
            <div className="h-3.5 w-20 rounded-sm bg-surface-sunken" />
            <div className="mt-5 h-11 w-full max-w-lg rounded-md bg-surface-sunken" />
            <div className="mt-5 h-5 w-full max-w-md rounded-md bg-surface-sunken" />
            <div className="mt-8 h-14 max-w-2xl rounded-lg bg-surface-sunken" />
          </div>
        </div>
      </div>

      <p role="status" className="sr-only">
        {copy.search.searching}
      </p>

      <div className="container-shell py-12 md:py-16" aria-hidden="true">
        <div className="h-7 w-56 max-w-full rounded-md bg-surface-sunken" />
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <PropertyCardSkeleton key={index} />
          ))}
        </div>
      </div>
    </>
  );
}
