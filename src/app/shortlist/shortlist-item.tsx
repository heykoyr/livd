import Link from 'next/link';

import { ConfidenceChip, ScoreBadge } from '@/components/property/score';
import { Button } from '@/components/ui/button';
import { Card, Meter } from '@/components/ui/primitives';
import { copy } from '@/content/copy';
import { propertyContextLine, propertyDisplayName } from '@/lib/format';
import { scoreBand } from '@/lib/intelligence/scoring';
import { removeSavedProperty, setShortlistNote } from '@/server/actions/saved';
import type { PropertySummary, SavedProperty } from '@/types/domain';

/**
 * One saved property.
 *
 * The note is a plain uncontrolled form posting to a Server Action, so it works
 * without JavaScript and needs no client bundle. A shortlist note is the kind of
 * thing people write on a phone with a bad connection, standing outside a
 * building — it should not depend on hydration having finished.
 */
export function ShortlistItem({
  entry,
}: {
  entry: SavedProperty & { summary: PropertySummary };
}) {
  const { property, intelligence } = entry.summary;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-display text-title-md tracking-tightish text-ink">
            <Link href={`/property/${property.slug}`} className="hover:underline">
              {propertyDisplayName(property.address)}
            </Link>
          </h3>
          <p className="mt-0.5 text-label text-ink-muted">
            {propertyContextLine(property.address)}
          </p>
          <div className="mt-3">
            <ConfidenceChip
              confidence={intelligence.confidence}
              reviewCount={intelligence.reviewCount}
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <ScoreBadge score={intelligence.overallScore} confidence={intelligence.confidence} />
          <form action={removeSavedProperty}>
            <input type="hidden" name="propertyId" value={property.id} />
            <Button type="submit" variant="ghost" size="sm">
              {copy.shortlist.remove}
            </Button>
          </form>
        </div>
      </div>

      {intelligence.overallScore !== null && (
        <Meter
          className="mt-4"
          value={intelligence.overallScore}
          tone={scoreBand(intelligence.overallScore)}
          label={`${copy.score.label} ${intelligence.overallScore} ${copy.score.outOf}`}
        />
      )}

      <form action={setShortlistNote} className="mt-5 flex flex-wrap items-end gap-3">
        <input type="hidden" name="propertyId" value={property.id} />
        <label className="min-w-0 flex-1">
          <span className="block text-label font-medium text-ink">
            {copy.shortlist.noteLabel}
          </span>
          <input
            type="text"
            name="note"
            defaultValue={entry.note ?? ''}
            maxLength={500}
            placeholder={copy.shortlist.notePlaceholder}
            className="mt-1.5 h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-body text-ink placeholder:text-ink-subtle"
          />
        </label>
        <Button type="submit" variant="secondary" size="sm">
          Save note
        </Button>
      </form>
    </Card>
  );
}
