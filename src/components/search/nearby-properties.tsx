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
      if (!reading) return;

      const formData = new FormData();
      formData.set('latitude', String(reading.latitude));
      formData.set('longitude', String(reading.longitude));

      setState(await findNearbyProperties(initialNearbyState, formData));
    } finally {
      setWorking(false);
      // The reading has done its work.
      geo.clear();
    }
  }, [geo]);

  const denied = geo.error === 'permission_denied';
  const busy = working || geo.status === 'requesting';

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
              {copy.verification.nearbyLead}
            </p>
          </div>

          <Button
            onClick={run}
            loading={busy}
            loadingLabel={copy.verification.nearbyWorking}
            variant="secondary"
            className="shrink-0"
          >
            {copy.verification.nearbyCta}
          </Button>
        </div>

        {(denied || geo.error || state.error) && (
          <p role="status" aria-live="polite" className="mt-4 text-label text-ink-muted">
            {denied
              ? copy.verification.errors.permissionDeniedBody
              : (state.error ?? copy.verification.errors.unavailableBody)}
          </p>
        )}

        {state.status === 'ready' && state.items.length === 0 && (
          <p role="status" aria-live="polite" className="mt-4 text-label text-ink-muted">
            {copy.verification.nearbyEmpty}
          </p>
        )}

        {state.items.length > 0 && (
          <ul className="mt-5 flex flex-col gap-2" aria-live="polite">
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
                      {item.context} ·{' '}
                      {copy.property.reviewCount(item.reviewCount)}
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
        )}
      </Card>
    </section>
  );
}
