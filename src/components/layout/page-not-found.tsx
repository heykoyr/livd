import { SearchCombobox } from '@/components/search/search-combobox';
import { ButtonLink } from '@/components/ui/button';
import { copy } from '@/content/copy';

/**
 * What a 404 says, wherever it is shown.
 *
 * Livd shows two, reached differently and framed differently:
 * `app/not-found.tsx`, inside the site chrome, when a route calls
 * `notFound()`; and `app/global-not-found.tsx`, a document of its own, when a
 * URL matches no route at all. The message is the same either way, so it is
 * written once rather than twice and left to drift.
 *
 * The search box is the point of the page. Almost every 404 here is a mistyped
 * or stale link from somebody looking for a real property, and searching the
 * address is the shortest way back to it.
 *
 * The caller owns the container and the padding, because the two framings need
 * different ones.
 */
export function PageNotFound() {
  return (
    <div className="w-full max-w-xl">
      <p className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">404</p>
      <h1 className="mt-4 font-display text-display-lg tracking-display text-ink">
        {copy.errors.notFoundTitle}
      </h1>
      <p className="mt-4 text-body-lg text-ink-muted">{copy.errors.notFoundBody}</p>

      <div className="mt-8">
        <SearchCombobox size="lg" />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <ButtonLink href="/places" variant="secondary">
          {copy.nav.explore}
        </ButtonLink>
        <ButtonLink href="/" variant="secondary">
          {copy.errors.notFoundHome}
        </ButtonLink>
      </div>
    </div>
  );
}
