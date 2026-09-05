import Link from 'next/link';

import { ConfidenceChip, ScoreBadge, TrendPill } from '@/components/property/score';
import { categoryLabel } from '@/config/categories';
import { departureReasonLabel } from '@/config/departure-reasons';
import { copy } from '@/content/copy';
import { formatMoney, formatPercent, propertyContextLine, propertyDisplayName } from '@/lib/format';
import { scoreBand } from '@/lib/intelligence/scoring';
import { cn } from '@/lib/utils';
import type { PropertySummary } from '@/types/domain';

/**
 * Side-by-side comparison.
 *
 * A real `<table>`, because this is tabular data and a screen reader should be
 * able to say "Meridian Court, management and landlord, 48". Row headers are
 * `<th scope="row">`, the first column is pinned while the rest scroll on a
 * phone, and the best value in each row is marked with a word as well as
 * weight, so the highlight does not depend on noticing bold text.
 *
 * Only categories at least two of the compared properties have scored appear —
 * a row where three of four cells say "no data" is noise, not information.
 */
export function ComparisonTable({ summaries }: { summaries: PropertySummary[] }) {
  const categoryKeys = sharedCategories(summaries);

  return (
    <div className="mt-5 overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[42rem] border-collapse text-left">
        <caption className="sr-only">
          Livd Scores and category scores for the properties on your shortlist
        </caption>

        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 w-44 border-b border-border bg-surface p-4 align-bottom text-micro font-semibold uppercase tracking-micro text-ink-subtle"
            >
              Property
            </th>
            {summaries.map(({ property, intelligence }) => (
              <th
                key={property.id}
                scope="col"
                className="min-w-52 border-b border-l border-border bg-surface p-4 align-bottom"
              >
                <Link
                  href={`/property/${property.slug}`}
                  className="block font-display text-title-md tracking-tightish text-ink hover:underline"
                >
                  {propertyDisplayName(property.address)}
                </Link>
                <span className="mt-0.5 block text-label font-normal text-ink-muted">
                  {propertyContextLine(property.address)}
                </span>
                <span className="mt-3 block">
                  <ScoreBadge
                    score={intelligence.overallScore}
                    confidence={intelligence.confidence}
                  />
                </span>
                <span className="mt-2 flex flex-wrap gap-1.5">
                  <ConfidenceChip
                    confidence={intelligence.confidence}
                    reviewCount={intelligence.reviewCount}
                  />
                  <TrendPill
                    direction={intelligence.trend.direction}
                    delta={intelligence.trend.delta}
                  />
                </span>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          <Row
            label={copy.property.recommendRate(0).replace('0% ', '')}
            summaries={summaries}
            render={({ intelligence }) =>
              intelligence.recommendRate === null
                ? null
                : formatPercent(intelligence.recommendRate)
            }
            valueOf={({ intelligence }) => intelligence.recommendRate}
          />

          <Row
            label={copy.property.reportedRent}
            summaries={summaries}
            render={({ property, intelligence }) =>
              intelligence.reportedRent
                ? `${formatMoney(intelligence.reportedRent.median, {
                    countryCode: property.address.countryCode,
                    compact: true,
                  })}/${intelligence.reportedRent.period === 'month' ? 'mo' : 'yr'}`
                : null
            }
            // Rent is not comparable across currencies, so nothing is "best".
            valueOf={() => null}
          />

          {categoryKeys.map((categoryKey) => (
            <Row
              key={categoryKey}
              label={categoryLabel(categoryKey)}
              summaries={summaries}
              render={({ intelligence }) => {
                const score = intelligence.categoryScores.find(
                  (c) => c.categoryKey === categoryKey,
                )?.score;
                return score == null ? null : String(score);
              }}
              valueOf={({ intelligence }) =>
                intelligence.categoryScores.find((c) => c.categoryKey === categoryKey)?.score ??
                null
              }
              tone
            />
          ))}

          <Row
            label={copy.property.departuresTitle}
            summaries={summaries}
            render={({ intelligence }) => {
              const top = intelligence.departures.reasons[0];
              if (intelligence.departures.suppressed || !top) return null;
              return `${departureReasonLabel(top.reasonKey)} (${Math.round(top.share * 100)}%)`;
            }}
            valueOf={() => null}
          />
        </tbody>
      </table>
    </div>
  );
}

function Row({
  label,
  summaries,
  render,
  valueOf,
  tone = false,
}: {
  label: string;
  summaries: PropertySummary[];
  render: (summary: PropertySummary) => string | null;
  valueOf: (summary: PropertySummary) => number | null;
  tone?: boolean;
}) {
  const values = summaries.map(valueOf);
  const comparable = values.filter((v): v is number => v !== null);
  // A "best" is only meaningful when more than one property has a value.
  const best = comparable.length > 1 ? Math.max(...comparable) : null;

  return (
    <tr className="border-b border-border last:border-b-0">
      <th
        scope="row"
        className="sticky left-0 z-10 bg-surface p-4 text-label font-medium text-ink"
      >
        {label}
      </th>

      {summaries.map((summary, index) => {
        const text = render(summary);
        const value = values[index] ?? null;
        const isBest = best !== null && value !== null && value === best;

        return (
          <td
            key={summary.property.id}
            className={cn(
              'border-l border-border p-4 text-body tabular',
              text === null && 'text-ink-subtle',
              tone && value !== null && toneClass(value),
            )}
          >
            {text ?? '—'}
            {isBest && (
              <>
                {' '}
                <span className="text-micro font-semibold uppercase tracking-micro text-positive">
                  Best
                </span>
              </>
            )}
          </td>
        );
      })}
    </tr>
  );
}

const TONE_CLASSES: Record<string, string> = {
  strong: 'text-score-strong',
  good: 'text-score-good',
  mixed: 'text-score-mixed',
  weak: 'text-score-weak',
  poor: 'text-score-poor',
};

function toneClass(score: number): string {
  return TONE_CLASSES[scoreBand(score)] ?? 'text-ink';
}

/** Categories at least two of the compared properties have a score for. */
function sharedCategories(summaries: PropertySummary[]): string[] {
  const counts = new Map<string, number>();

  for (const summary of summaries) {
    for (const category of summary.intelligence.categoryScores) {
      if (category.score === null) continue;
      counts.set(category.categoryKey, (counts.get(category.categoryKey) ?? 0) + 1);
    }
  }

  const ordered = summaries[0]?.intelligence.categoryScores.map((c) => c.categoryKey) ?? [];
  const extra = [...counts.keys()].filter((key) => !ordered.includes(key));

  return [...ordered, ...extra].filter((key) => (counts.get(key) ?? 0) >= 2);
}
