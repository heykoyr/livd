import { SearchCombobox } from '@/components/search/search-combobox';
import { ButtonLink } from '@/components/ui/button';
import { copy } from '@/content/copy';

/**
 * Shown in place of a property that does not exist.
 *
 * Rendered inline by the property page rather than through `notFound()`. The
 * page marks itself `noindex, follow` and renders this instead. The trade is a
 * soft 404: the status is 200 rather than 404. `noindex` keeps the page out of
 * search indexes, which is the outcome the 404 status was for, and in exchange
 * a stale property link stays a usable, readable page for the person who
 * followed it. Unmatched URLs still get a true 404 through
 * `global-not-found.tsx`.
 *
 * This began as a workaround, and that part is no longer true. The note here
 * used to say that a not-found boundary renders outside the root layout, in a
 * bare document with no `lang` attribute and no chrome, and that neither a
 * segment-level `not-found.tsx` nor a root one changed it. `app/not-found.tsx`
 * now renders inside the layout with the header, the footer and the visitor's
 * theme — verified in a production build against `/places/zz`.
 *
 * So this is a choice again rather than a necessity, and it stays, because
 * what `notFound()` would buy is the status code and it may not even buy that:
 * a streamed response is 200 either way, which is what `/places/zz` returns
 * today. What it would cost is this page's own words — "We could not find that
 * property", and the offer to add it — which the shared boundary cannot say.
 * A `not-found.tsx` under `property/[slug]` could hold them, the day a true
 * 404 on a stale property URL matters more than the wording does.
 */
export function PropertyMissing() {
  return (
    <div className="container-shell py-16 md:py-24">
      <div className="w-full max-w-xl">
        <p className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
          Not found
        </p>
        <h1 className="mt-4 font-display text-display-lg tracking-display text-ink">
          {copy.errors.propertyNotFoundTitle}
        </h1>
        <p className="mt-4 text-body-lg text-ink-muted">{copy.errors.propertyNotFoundBody}</p>

        <div className="mt-8">
          <SearchCombobox size="lg" />
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/places" variant="secondary">
            {copy.nav.explore}
          </ButtonLink>
          <ButtonLink href="/review/new-property" variant="secondary">
            {copy.search.addProperty}
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
