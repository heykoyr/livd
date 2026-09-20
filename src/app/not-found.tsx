import { PageNotFound } from '@/components/layout/page-not-found';

/**
 * The 404 a route asks for, by calling `notFound()`.
 *
 * Without this file Next renders its own built-in 404 — "404 | This page could
 * not be found." in the system font — in the middle of Livd's header and
 * footer, which reads as a page that broke rather than a record that is not
 * there. Worse, it brought an unlayered stylesheet that coloured `body` by the
 * operating system's scheme, which beat every layered token rule: a visitor who
 * had chosen the light theme got a black page whenever their OS was dark.
 * `globals.css` carried an override for that, and this file is what let it go.
 * Deleting this one would bring both back, which is why a test asserts it.
 *
 * It carries no `metadata` export. A not-found boundary is not a page, and the
 * title is already set by the route that called `notFound()` — "Place not
 * found · Livd" from `places/[country]`, for instance — which is more specific
 * than anything this file could say.
 *
 * Unmatched URLs do not come here. They never reach a route, so they are
 * answered by `global-not-found.tsx`, which owns a whole document.
 */
export default function NotFound() {
  return (
    <div className="container-shell py-16 md:py-24">
      <PageNotFound />
    </div>
  );
}
