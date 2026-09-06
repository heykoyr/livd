import { Badge, Card, Meter } from '@/components/ui/primitives';
import { CATEGORY_DEFINITIONS, categoryLabel, getCategory } from '@/config/categories';
import { departureReasonLabel, getDepartureReason } from '@/config/departure-reasons';
import { tagLabel } from '@/config/tags';
import { copy } from '@/content/copy';
import { formatPercent } from '@/lib/format';
import { scoreBand } from '@/lib/intelligence/scoring';
import { partitionDepartures } from '@/lib/intelligence/departures';
import { cn } from '@/lib/utils';
import type {
  DepartureBreakdown,
  PreVisitCheck,
  PropertyIntelligence,
  ResidentVerdict,
  TimelineEntry,
} from '@/types/domain';

/* -------------------------------------------------------------------------
 * Resident verdict
 * ---------------------------------------------------------------------- */

/**
 * What residents collectively say.
 *
 * Every clause is assembled from aggregates that have already cleared their own
 * disclosure threshold, and the basis line states the sample it rests on. It
 * cannot say anything residents did not report, because it has no access to
 * anything else.
 */
export function ResidentVerdictPanel({
  verdict,
  className,
}: {
  verdict: ResidentVerdict;
  className?: string;
}) {
  return (
    <Card className={cn('p-6 md:p-8', className)}>
      {/* A real h2: the strengths and concerns beneath are h3s, and without a
          heading here the page jumps from h1 straight to h3. */}
      <h2 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
        {copy.property.residentVerdict}
      </h2>

      <p className="mt-4 max-w-prose font-display text-title-lg leading-snug tracking-tightish text-ink">
        {verdict.summary}
      </p>

      {(verdict.strengths.length > 0 || verdict.concerns.length > 0) && (
        <div className="mt-7 grid gap-6 border-t border-border pt-6 sm:grid-cols-2">
          {verdict.strengths.length > 0 && (
            <div>
              <h3 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                {copy.property.strengths}
              </h3>
              <ul className="mt-3 flex flex-col gap-2">
                {verdict.strengths.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-body text-ink">
                    <PlusIcon />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {verdict.concerns.length > 0 && (
            <div>
              <h3 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
                {copy.property.concerns}
              </h3>
              <ul className="mt-3 flex flex-col gap-2">
                {verdict.concerns.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-body text-ink">
                    <MinusIcon />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <p className="mt-6 text-micro text-ink-subtle">
        {copy.property.verdictBasis(
          verdict.basis.reviewCount,
          copy.score.confidenceShort[verdict.basis.confidence].toLowerCase(),
        )}
      </p>
    </Card>
  );
}

/* -------------------------------------------------------------------------
 * Category scores
 * ---------------------------------------------------------------------- */

/**
 * Category scores, split into the core set every resident is asked about and
 * the extended set that only appears where residents here actually rated it.
 *
 * That split is the mechanism behind the product being genuinely global: a
 * London flat is never scored on generator reliability, and a Lagos apartment
 * is never scored on central heating, without a single country conditional in
 * this component.
 */
export function CategoryScores({
  intelligence,
  className,
}: {
  intelligence: PropertyIntelligence;
  className?: string;
}) {
  const scored = intelligence.categoryScores.filter((c) => c.score !== null);
  if (scored.length === 0) return null;

  const core = scored.filter((c) => getCategory(c.categoryKey)?.isCore);
  const extended = scored.filter((c) => !getCategory(c.categoryKey)?.isCore);

  return (
    <div className={className}>
      <ul className="flex flex-col">
        {core.map((category) => (
          <CategoryRow key={category.categoryKey} category={category} />
        ))}
      </ul>

      {extended.length > 0 && (
        <>
          <h3 className="mt-8 text-micro font-semibold uppercase tracking-micro text-ink-subtle">
            {copy.property.extendedCategories}
          </h3>
          <ul className="mt-2 flex flex-col">
            {extended.map((category) => (
              <CategoryRow key={category.categoryKey} category={category} />
            ))}
          </ul>
        </>
      )}

      {/* Categories residents rated but too few times to publish. */}
      <UnderSampledNote intelligence={intelligence} />
    </div>
  );
}

function CategoryRow({
  category,
}: {
  category: PropertyIntelligence['categoryScores'][number];
}) {
  const definition = getCategory(category.categoryKey);
  const band = scoreBand(category.score);

  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 border-b border-border py-4 last:border-b-0 sm:grid-cols-[minmax(0,14rem)_1fr_auto]">
      <div className="min-w-0">
        <p className="text-body font-medium text-ink">{categoryLabel(category.categoryKey)}</p>
        {definition && (
          <p className="mt-0.5 text-label text-ink-muted">{definition.description}</p>
        )}
      </div>

      <Meter
        value={category.score ?? 0}
        tone={band}
        label={`${categoryLabel(category.categoryKey)}: ${category.score} ${copy.score.outOf}`}
        className="col-span-2 order-last sm:order-none sm:col-span-1"
      />

      <div className="text-right">
        <span className={cn('text-title-md font-medium tabular', scoreTextTone(band))}>
          {category.score}
        </span>
        <span className="block text-micro text-ink-subtle">
          {copy.property.categoryRatedBy(category.sampleSize)}
        </span>
      </div>
    </li>
  );
}

function UnderSampledNote({ intelligence }: { intelligence: PropertyIntelligence }) {
  const underSampled = intelligence.categoryScores.filter((c) => c.score === null);
  if (underSampled.length === 0) return null;

  const names = underSampled.map((c) => categoryLabel(c.categoryKey));

  return (
    <p className="mt-5 text-label text-ink-subtle">
      Too few residents have rated {formatList(names)} for Livd to publish a score for{' '}
      {names.length === 1 ? 'it' : 'them'} yet.
    </p>
  );
}

function scoreTextTone(band: string): string {
  return (
    {
      strong: 'text-score-strong',
      good: 'text-score-good',
      mixed: 'text-score-mixed',
      weak: 'text-score-weak',
      poor: 'text-score-poor',
    }[band] ?? 'text-ink-subtle'
  );
}

/* -------------------------------------------------------------------------
 * Why residents leave
 * ---------------------------------------------------------------------- */

/**
 * The signature section.
 *
 * Property-caused reasons lead; personal circumstances are shown separately and
 * plainly labelled. Conflating the two would let a building where everyone left
 * because they bought a house read as one people fled.
 */
export function DepartureBreakdownPanel({
  departures,
  countryCode,
  className,
}: {
  departures: DepartureBreakdown;
  countryCode: string;
  className?: string;
}) {
  if (departures.suppressed) {
    return (
      <Card className={cn('border-dashed p-6', className)}>
        <h3 className="font-display text-title-md tracking-tightish text-ink">
          {copy.property.departuresSuppressedTitle}
        </h3>
        <p className="mt-2 max-w-prose text-body text-ink-muted">
          {copy.property.departuresSuppressedBody}
        </p>
        {departures.respondents > 0 && (
          <p className="mt-3 text-label text-ink-subtle">
            {departures.respondents} former{' '}
            {departures.respondents === 1 ? 'resident has' : 'residents have'} shared a reason so
            far.
          </p>
        )}
      </Card>
    );
  }

  const { propertyRelated, personal } = partitionDepartures(departures);

  return (
    <div className={className}>
      <p className="text-label text-ink-muted">
        {copy.property.departuresLead(departures.respondents)}
      </p>

      {propertyRelated.length > 0 && (
        <>
          <h3 className="mt-6 text-micro font-semibold uppercase tracking-micro text-ink-subtle">
            {copy.property.departuresPropertyRelated}
          </h3>
          <ul className="mt-3 flex flex-col gap-3">
            {propertyRelated.map((reason) => (
              <DepartureRow
                key={reason.reasonKey}
                reasonKey={reason.reasonKey}
                count={reason.count}
                share={reason.share}
                countryCode={countryCode}
                tone="property"
              />
            ))}
          </ul>
        </>
      )}

      {personal.length > 0 && (
        <>
          <h3 className="mt-8 text-micro font-semibold uppercase tracking-micro text-ink-subtle">
            {copy.property.departuresPersonal}
          </h3>
          <ul className="mt-3 flex flex-col gap-3">
            {personal.map((reason) => (
              <DepartureRow
                key={reason.reasonKey}
                reasonKey={reason.reasonKey}
                count={reason.count}
                share={reason.share}
                countryCode={countryCode}
                tone="personal"
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function DepartureRow({
  reasonKey,
  count,
  share,
  countryCode,
  tone,
}: {
  reasonKey: string;
  count: number;
  share: number;
  countryCode: string;
  tone: 'property' | 'personal';
}) {
  const definition = getDepartureReason(reasonKey);

  return (
    <li>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-body text-ink">{departureReasonLabel(reasonKey)}</span>
        <span className="shrink-0 text-label tabular text-ink-muted">
          <span className="font-medium text-ink">{formatPercent(share, countryCode)}</span>
          <span className="ml-2 text-ink-subtle">
            {count} {count === 1 ? 'person' : 'people'}
          </span>
        </span>
      </div>

      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
        role="meter"
        aria-valuenow={Math.round(share * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${departureReasonLabel(reasonKey)}: ${count} of former residents`}
      >
        <div
          className={cn(
            'h-full rounded-full',
            tone === 'property' ? 'bg-accent' : 'bg-border-strong',
          )}
          style={{ width: `${Math.max(2, share * 100)}%` }}
        />
      </div>

      {definition?.isSensitive && (
        <p className="mt-1.5 text-micro text-ink-subtle">
          Counted here, but Livd does not publish details of this on a property page.
        </p>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------
 * Check before you visit
 * ---------------------------------------------------------------------- */

/**
 * The most directly useful thing on the page: the property's weak points turned
 * into questions the reader can ask out loud at a viewing. Each carries the
 * evidence that produced it, so nothing reads as an accusation.
 */
export function PreVisitChecks({
  checks,
  className,
}: {
  checks: PreVisitCheck[];
  className?: string;
}) {
  if (checks.length === 0) return null;

  return (
    <ol className={cn('flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border', className)}>
      {checks.map((check, index) => (
        <li key={`${check.categoryKey}-${index}`} className="bg-surface p-5">
          <div className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-border-strong text-micro font-semibold tabular text-ink-muted"
            >
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-body-lg text-ink">{check.question}</p>
              <p className="mt-1.5 text-label text-ink-muted">{check.reason}</p>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* -------------------------------------------------------------------------
 * Timeline
 * ---------------------------------------------------------------------- */

export function PropertyTimeline({
  entries,
  className,
}: {
  entries: TimelineEntry[];
  className?: string;
}) {
  if (entries.length === 0) return null;

  return (
    <ol className={cn('relative flex flex-col', className)}>
      {entries.map((entry, index) => (
        <li key={`${entry.year}-${entry.kind}-${index}`} className="relative flex gap-5 pb-7 last:pb-0">
          {/* Connector, drawn between markers rather than through the last one. */}
          {index < entries.length - 1 && (
            <span
              aria-hidden="true"
              className="absolute left-[7px] top-5 h-full w-px bg-border"
            />
          )}

          <span
            aria-hidden="true"
            className={cn(
              'relative mt-1.5 size-[15px] shrink-0 rounded-full border-2 bg-canvas',
              entry.kind === 'management_change' ? 'border-accent' : 'border-border-strong',
            )}
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-title-md tabular text-ink">{entry.year}</span>
              <Badge tone={timelineTone(entry.kind)}>{timelineLabel(entry.kind)}</Badge>
            </div>
            <p className="mt-1.5 max-w-prose text-body text-ink-muted">{entry.summary}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function timelineLabel(kind: TimelineEntry['kind']): string {
  return {
    score_shift: 'Rating change',
    management_change: 'Management',
    rent_change: 'Rent',
    volume: 'Record begins',
  }[kind];
}

function timelineTone(kind: TimelineEntry['kind']): 'neutral' | 'accent' | 'info' {
  if (kind === 'management_change') return 'accent';
  if (kind === 'rent_change') return 'info';
  return 'neutral';
}

/* -------------------------------------------------------------------------
 * Tag summaries
 * ---------------------------------------------------------------------- */

export function TagFrequencyList({
  tags,
  reviewCount,
  polarity,
  className,
}: {
  tags: PropertyIntelligence['topPositiveTags'];
  reviewCount: number;
  polarity: 'positive' | 'problem';
  className?: string;
}) {
  if (tags.length === 0) return null;

  return (
    <ul className={cn('flex flex-col gap-2.5', className)}>
      {tags.map((tag) => (
        <li key={tag.tagKey} className="flex items-baseline justify-between gap-4">
          <span className="flex items-start gap-2 text-body text-ink">
            {polarity === 'positive' ? <PlusIcon /> : <MinusIcon />}
            {tagLabel(tag.tagKey)}
          </span>
          <span className="shrink-0 text-label tabular text-ink-subtle">
            {tag.count} of {reviewCount}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------
 * Shared
 * ---------------------------------------------------------------------- */

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" className="mt-1 size-3.5 shrink-0 text-positive" fill="none" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg viewBox="0 0 16 16" className="mt-1 size-3.5 shrink-0 text-caution" fill="none" aria-hidden="true">
      <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function formatList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!.toLowerCase();
  const lower = items.map((item) => item.toLowerCase());
  return `${lower.slice(0, -1).join(', ')} and ${lower[lower.length - 1]}`;
}

/** Re-exported so the property page can order sections without a second import. */
export { CATEGORY_DEFINITIONS };
