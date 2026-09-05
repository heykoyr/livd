import { ButtonLink } from '@/components/ui/button';
import { copy } from '@/content/copy';

export default function NotFound() {
  return (
    <div className="container-shell flex min-h-[60vh] items-center py-20">
      <div className="max-w-lg">
        <p className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">404</p>
        <h1 className="mt-4 font-display text-display-lg tracking-display text-ink">
          {copy.errors.notFoundTitle}
        </h1>
        <p className="mt-4 text-body-lg text-ink-muted">{copy.errors.notFoundBody}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/search">{copy.search.heading}</ButtonLink>
          <ButtonLink href="/" variant="secondary">
            Go to the homepage
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
