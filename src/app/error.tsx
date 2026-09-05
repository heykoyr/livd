'use client';

import { useEffect } from 'react';

import { Button, ButtonLink } from '@/components/ui/button';
import { copy } from '@/content/copy';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only safe identifier to surface: it correlates with the
    // server log without exposing a stack trace or a file path to the browser.
    console.error('Unhandled error', error.digest ?? error.message);
  }, [error]);

  return (
    <div className="container-shell flex min-h-[60vh] items-center py-20">
      <div className="max-w-lg">
        <h1 className="font-display text-display-lg tracking-display text-ink">
          {copy.errors.genericTitle}
        </h1>
        <p className="mt-4 text-body-lg text-ink-muted">{copy.errors.genericBody}</p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button onClick={reset}>{copy.common.retry}</Button>
          <ButtonLink href="/" variant="secondary">
            Go to the homepage
          </ButtonLink>
        </div>

        {error.digest && (
          <p className="mt-8 text-micro text-ink-subtle">
            Reference: <span className="tabular">{error.digest}</span>
          </p>
        )}
      </div>
    </div>
  );
}
