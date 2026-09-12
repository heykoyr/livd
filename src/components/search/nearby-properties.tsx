'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/primitives';
import { copy } from '@/content/copy';
import { formatDistance, formatRelativeTime } from '@/lib/format';
import { useGeolocation } from '@/lib/geo/use-geolocation';
import { findNearbyProperties } from '@/server/actions/property-verification';
import { initialNearbyState, type NearbyState } from '@/server/actions/action-state';

/**
 * Properties near the visitor.
 *
 * Everything about this component is arranged so that it cannot become
 * surveillance by accident:
 *
 *   - It asks for nothing on mount. No permission prompt, no reading, no
 *     `permissions.query` to see whether one would succeed. Until the button is
 *     pressed, this is inert markup.
 *   - One reading, on that press. `getCurrentPosition`, never `watchPosition`.
 *   - The position goes to the server, comes back as a list, and is dropped.
 *     Nothing stores it, and the action it calls writes no row.
 *   - No account is required. Finding out what is around you should not cost an
 *     identity, and since nothing is recorded there is nothing to attach to one.
 *
 * There is deliberately no notification, no "you're near a Livd property"
 * prompt and no background geofence. A product that tells you what building you
 * are standing next to before you asked has told you it is watching.
 *
 * Search itself never needs any of this. Somebody who declines, or never
 * presses the button, uses the whole of Livd unimpeded.
 *
 * ── On the states ─────────────────────────────────────────────────────────
 *
 * This used to collapse every outcome into "No Livd properties within a short
 * walk": a denied permission, a timeout, an unsupported browser, an empty
 * area, and an area whose properties Livd holds without coordinates all
 * produced the same sentence. Four of those five were being told something
 * untrue, and the one real bug hid behind the wording for exactly that reason —
 * somebody stood inside a property they had reviewed and was told there was
 * nothing near them, because that property had no coordinates and the
 * proximity query could not consider it.
 *
 * So each outcome now says what actually happened, and each one that a person
 * can act on says what to do.
 */
export function NearbyProperties() {
  const geo = useGeolocation();
  const [state, setState] = useState<NearbyState>(initialNearbyState);
  const [working, setWorking] = useState(false);

  const run = useCallback(async () => {
    setState(initialNearbyState);
    setWorking(true);

    try {
      const reading = await geo.request();

      /**
       * A null reading means the hook is holding an error — a denial, a
       * timeout, an unsupported browser — and that error is what the interface
       * renders. So it must survive this function.
       *
       * `geo.clear()` used to run in a `finally`, which reset the hook to its
       * initial state on every path including the failures. The error was
       * therefore erased microseconds after it was set, every outcome arrived
       * at the render with `error: null` and an empty item list, and all five
       * states collapsed into one. That is the same defect as the empty-state
       * wording, one layer down, and no amount of copy would have fixed it.
       *
       * What `clear()` is actually for is dropping the position once it has
       * been used. An error code is not a position, so it is not its business.
       */
      if (!reading) return;

      const formData = new FormData();
      formData.set('latitude', String(reading.latitude));
      formData.set('longitude', String(reading.longitude));

      setState(await findNearbyProperties(initialNearbyState, formData));

      // The reading has done its work. Dropped here rather than in a
      // `finally`, so only a position that existed is cleared.
      geo.clear();
    } finally {
      setWorking(false);
    }
  }, [geo]);

  const busy = working || geo.status === 'requesting';

  /**
   * The radius, in the units the results are already using.
   *
   * `formatDistance` is market-aware — a property in the United States reads
   * "1,200 ft", one in Nigeria reads "370 m" — so labelling the radius in
   * metric regardless would put "within 3 km" directly above "0.7 mi away".
   * Anything near you is by definition in your country, so the first result
   * is the right thing to take the units from. With no results there is
   * nothing to be consistent with, and metric is the product's default.
   */
  const radiusLabel = (meters: number): string =>
    formatDistance(meters, state.items[0]?.countryCode);

  return (
    <section aria-labelledby="nearby-heading" className="mt-10">
      <Card className="p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="nearby-heading"
              className="font-display text-title-md tracking-tightish text-ink"
            >
              {copy.verification.nearbyTitle}
            </h2>
            <p className="mt-1.5 max-w-prose text-label text-ink-muted">
              {state.outcome === 'found' && state.radiusMeters !== null
                ? copy.verification.nearbyFoundWithin(radiusLabel(state.radiusMeters))
                : copy.verification.nearbyIdle}
            </p>
          </div>

          <Button
            onClick={run}
            loading={busy}
            loadingLabel={copy.verification.nearbyLoading}
            variant="secondary"
            className="shrink-0"
          >
            {copy.verification.nearbyCta}
          </Button>
        </div>

        {/* One live region for every outcome, so a screen reader hears the
            result of the press rather than nothing. */}
        <div role="status" aria-live="polite">
          {busy && (
            <p className="mt-4 text-label text-ink-muted">
              {copy.verification.nearbyLoading}…
            </p>
          )}

          {!busy && <Outcome geo={geo} state={state} onRetry={run} />}
        </div>

        {!busy && state.items.length > 0 && (
          <>
            {/* Said out loud whenever the search widened past the first stage.
                "Near you" about a three-kilometre radius is not true unless the
                page says that is what it means. */}
            {state.radiusMeters !== null && state.radiusMeters > 500 && (
              <p className="mt-4 text-label text-ink-subtle">
                {copy.verification.nearbyWidened(radiusLabel(state.radiusMeters))}
              </p>
            )}

            <ul className="mt-5 flex flex-col gap-2">
              {state.items.map((item) => (
                <li key={item.slug}>
                  <Link
                    href={`/property/${item.slug}`}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-border px-4 py-3 transition-colors duration-fast hover:border-border-strong hover:bg-surface-sunken/40"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium text-ink">{item.name}</span>
                        {item.isDemo && <Badge tone="accent">{copy.property.demoBadge}</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-label text-ink-muted">
                        {item.context} · {copy.property.reviewCount(item.reviewCount)}
                        {item.verifiedCount > 0 && `, ${item.verifiedCount} verified`}
                        {item.lastReviewAt &&
                          ` · reviewed ${formatRelativeTime(item.lastReviewAt, item.countryCode)}`}
                      </span>
                    </span>

                    <span className="shrink-0 text-label tabular text-ink-subtle">
                      {copy.verification.nearbyDistance(
                        formatDistance(item.distanceMeters, item.countryCode),
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * The five outcomes
 * ---------------------------------------------------------------------- */

/**
 * Which of the five states to render, decided in one place.
 *
 * The browser's failure modes come first, because they are not results: a
 * denied permission is not an empty neighbourhood, and conflating the two is
 * what this component was rewritten to stop doing.
 */
function Outcome({
  geo,
  state,
  onRetry,
}: {
  geo: ReturnType<typeof useGeolocation>;
  state: NearbyState;
  onRetry: () => void;
}) {
  /* B — the browser or the person refused. Not retryable in-page: the switch
     is in browser settings, so pressing the button again would just fail. */
  if (geo.error === 'permission_denied') {
    return (
      <Note
        title={copy.verification.nearbyDeniedTitle}
        body={copy.verification.nearbyDeniedBody}
        action={<SearchInstead />}
      />
    );
  }

  /* E — no geolocation at all. Offering a retry would be dishonest. */
  if (geo.error === 'unsupported') {
    return (
      <Note
        title={copy.verification.nearbyUnsupportedTitle}
        body={copy.verification.nearbyUnsupportedBody}
        action={<SearchInstead />}
      />
    );
  }

  /* E — a timeout or a transient device failure. Genuinely worth retrying. */
  if (geo.error === 'timeout' || geo.error === 'unavailable') {
    return (
      <Note
        title={copy.verification.nearbyTimedOutTitle}
        body={copy.verification.nearbyTimedOutBody}
        action={
          <button
            type="button"
            onClick={onRetry}
            className="rounded-sm text-label font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
          >
            {copy.verification.nearbyRetry}
          </button>
        }
      />
    );
  }

  /* E — the lookup reached the server and failed there. */
  if (state.status === 'error' && state.error) {
    return (
      <Note
        title={copy.verification.nearbyTimedOutTitle}
        body={state.error}
        action={
          <button
            type="button"
            onClick={onRetry}
            className="rounded-sm text-label font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
          >
            {copy.verification.nearbyRetry}
          </button>
        }
      />
    );
  }

  const radius = formatDistance(state.radiusMeters ?? 3000);

  /* C′ — located, nothing found, and Livd is holding properties it cannot
     place. The one state that explains the bug rather than hiding it. */
  if (state.outcome === 'none_locatable') {
    return (
      <Note
        title={copy.verification.nearbyUnlocatableTitle(radius)}
        body={copy.verification.nearbyUnlocatableBody(state.unlocatableCount)}
        action={<SearchInstead />}
      />
    );
  }

  /* C — located, and the area genuinely has nothing. */
  if (state.outcome === 'none_nearby') {
    return (
      <Note
        title={copy.verification.nearbyNoneTitle(radius)}
        body={copy.verification.nearbyNoneBody}
        action={
          <Link
            href="/review"
            className="rounded-sm text-label font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
          >
            {copy.nav.writeReview}
          </Link>
        }
      />
    );
  }

  /* A — not asked yet, or D — found, which the list below renders. */
  return null;
}

function Note({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mt-4 rounded-md border border-dashed border-border-strong bg-surface-sunken/40 p-4">
      <p className="text-label font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-prose text-label text-ink-muted">{body}</p>
      {action && <div className="mt-2.5">{action}</div>}
    </div>
  );
}

function SearchInstead() {
  return (
    <Link
      href="/search"
      className="rounded-sm text-label font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
    >
      {copy.verification.searchByAddress}
    </Link>
  );
}
