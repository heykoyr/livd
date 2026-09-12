import { SearchCombobox } from '@/components/search/search-combobox';
import { ButtonLink } from '@/components/ui/button';
import { copy } from '@/content/copy';

/**
 * Shown in place of a property that does not exist.
 *
 * Rendered inline by the property page rather than through `notFound()`, and
 * the reason is worth recording.
 *
 * Next 16 renders a not-found boundary *outside* the root layout, in a bare
 * document with no `lang` attribute, no site chrome and no styling. That is a
 * WCAG 3.1.1 failure, and it looks broken. Neither a segment-level
 * `not-found.tsx`, a root one, nor `global-not-found.tsx` changes it — verified
 * against a production build — and it is not caused by anything in the root
 * layout, which was also verified by removing its only dynamic call.
 *
 * So the page renders this instead and marks itself `noindex, follow`. The
 * trade is a soft 404: the status is 200 rather than 404. `noindex` keeps the
 * page out of search indexes, which is the outcome the 404 status was for,
 * and in exchange a stale property link stays a usable, readable page for the
 * person who followed it. Unmatched URLs still get a true 404 through
 * `global-not-found.tsx`.
 *
 * Revisit when the framework renders not-found boundaries inside the layout.
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
