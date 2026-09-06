import { copy } from '@/content/copy';
import { scoreBand, scoreWord } from '@/lib/intelligence/scoring';
import { cn } from '@/lib/utils';
import type { ConfidenceBand } from '@/types/domain';

/* -------------------------------------------------------------------------
 * Tone mapping
 * ---------------------------------------------------------------------- */

const TEXT_TONE: Record<string, string> = {
  strong: 'text-score-strong',
  good: 'text-score-good',
  mixed: 'text-score-mixed',
  weak: 'text-score-weak',
  poor: 'text-score-poor',
  unknown: 'text-score-unknown',
};

const STROKE_TONE: Record<string, string> = {
  strong: 'stroke-score-strong',
  good: 'stroke-score-good',
  mixed: 'stroke-score-mixed',
  weak: 'stroke-score-weak',
  poor: 'stroke-score-poor',
  unknown: 'stroke-score-unknown',
};

export function scoreTone(score: number | null): string {
  return TEXT_TONE[scoreBand(score)] ?? TEXT_TONE.unknown!;
}

/* -------------------------------------------------------------------------
 * Score dial
 * ---------------------------------------------------------------------- */

/**
 * The Livd Score, as an arc.
 *
 * Three things carry the meaning independently — the numeral, the word
 * underneath it, and the arc — so the reading survives colour-blindness,
 * greyscale printing and a screen read aloud.
 *
 * When there is no score, the dial says so in words rather than showing a zero.
 * A property nobody has reviewed has not scored badly; it has not been measured.
 */
export function ScoreDial({
  score,
  confidence,
  size = 'md',
  className,
}: {
  score: number | null;
  confidence: ConfidenceBand;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const band = scoreBand(score);
  const dimensions = { sm: 72, md: 104, lg: 132 }[size];
  const strokeWidth = { sm: 5, md: 6.5, lg: 8 }[size];

  const radius = (dimensions - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // Three-quarter arc, opening at the bottom — a full ring reads as a progress
  // spinner, which this is not.
  const arcFraction = 0.75;
  const arcLength = circumference * arcFraction;
  const filled = score === null ? 0 : (score / 100) * arcLength;

  if (score === null) {
    return (
      <div
        className={cn('flex flex-col items-center justify-center text-center', className)}
        style={{ width: dimensions, height: dimensions }}
      >
        <span
          className={cn(
            'font-display text-ink-subtle',
            size === 'lg' ? 'text-title-lg' : 'text-title-md',
          )}
        >
          —
        </span>
        <span className="mt-1 max-w-[8rem] text-micro leading-tight text-ink-subtle">
          {copy.score.noScoreTitle}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn('relative shrink-0', className)}
      style={{ width: dimensions, height: dimensions }}
      role="img"
      aria-label={`${copy.score.label} ${score} ${copy.score.outOf}. ${scoreWord(score)}. ${
        copy.score.confidence[confidence]
      }.`}
    >
      <svg
        viewBox={`0 0 ${dimensions} ${dimensions}`}
        className="size-full -rotate-[225deg]"
        aria-hidden="true"
      >
        <circle
          cx={dimensions / 2}
          cy={dimensions / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${arcLength} ${circumference}`}
          className="stroke-surface-sunken"
        />
        <circle
          cx={dimensions / 2}
          cy={dimensions / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          className={cn(STROKE_TONE[band], 'transition-[stroke-dasharray] duration-slow')}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={cn(
            'font-display font-medium tabular leading-none',
            TEXT_TONE[band],
            size === 'sm' && 'text-[1.375rem]',
            size === 'md' && 'text-[2rem]',
            size === 'lg' && 'text-[2.5rem]',
          )}
        >
          {score}
        </span>
        {size !== 'sm' && (
          <span className="mt-1 text-micro font-medium uppercase tracking-micro text-ink-subtle">
            {scoreWord(score)}
          </span>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Confidence
 * ---------------------------------------------------------------------- */

/**
 * Confidence is never optional next to a score.
 *
 * A number without its basis is the thing this product exists not to publish,
 * so the chip is a required prop of every score surface rather than a decoration
 * a caller can forget.
 */
export function ConfidenceChip({
  confidence,
  reviewCount,
  className,
}: {
  confidence: ConfidenceBand;
  reviewCount?: number;
  className?: string;
}) {
  const tone = {
    strong: 'border-positive/25 bg-positive-soft text-positive',
    moderate: 'border-border bg-surface-sunken text-ink-muted',
    limited: 'border-caution/25 bg-caution-soft text-caution',
    insufficient: 'border-border bg-surface-sunken text-ink-subtle',
  }[confidence];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-micro font-medium',
        tone,
        className,
      )}
    >
      <ConfidenceGlyph confidence={confidence} />
      {copy.score.confidenceShort[confidence]}
      {/* No opacity on the count. Dimming it to 80% blended the token toward
          the chip background and dropped it to 3.6:1 — and the count is the
          evidence behind the confidence word, not decoration. */}
      {reviewCount !== undefined && (
        <span className="tabular font-normal">
          · {reviewCount} {reviewCount === 1 ? 'review' : 'reviews'}
        </span>
      )}
    </span>
  );
}

/** Filled segments — a second, non-colour encoding of the same fact. */
function ConfidenceGlyph({ confidence }: { confidence: ConfidenceBand }) {
  const filled = { insufficient: 0, limited: 1, moderate: 2, strong: 3 }[confidence];

  return (
    <span aria-hidden="true" className="inline-flex items-end gap-[2px]">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            'w-[3px] rounded-[1px]',
            index === 0 && 'h-[5px]',
            index === 1 && 'h-[7px]',
            index === 2 && 'h-[9px]',
            index < filled ? 'bg-current' : 'bg-current/25',
          )}
        />
      ))}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Compact score
 * ---------------------------------------------------------------------- */

/** The score as it appears on cards and in the comparison table. */
export function ScoreBadge({
  score,
  confidence,
  className,
}: {
  score: number | null;
  confidence: ConfidenceBand;
  className?: string;
}) {
  if (score === null) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-md border border-dashed border-border-strong px-2 py-1 text-micro text-ink-subtle',
          className,
        )}
      >
        {copy.score.noScoreTitle}
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-baseline gap-1.5', className)}>
      <span className={cn('font-display text-[1.5rem] font-medium tabular leading-none', scoreTone(score))}>
        {score}
      </span>
      <span className="text-micro text-ink-subtle">/100</span>
      <span className="sr-only">
        {copy.score.label}, {scoreWord(score)}, {copy.score.confidence[confidence]}
      </span>
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Trend
 * ---------------------------------------------------------------------- */

export function TrendPill({
  direction,
  delta,
  className,
}: {
  direction: 'improving' | 'stable' | 'declining' | 'unknown';
  delta: number | null;
  className?: string;
}) {
  if (direction === 'unknown') return null;

  const tone = {
    improving: 'border-positive/25 bg-positive-soft text-positive',
    declining: 'border-critical/25 bg-critical-soft text-critical',
    stable: 'border-border bg-surface-sunken text-ink-muted',
  }[direction];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-micro font-medium',
        tone,
        className,
      )}
    >
      <TrendArrow direction={direction} />
      {copy.score.trend[direction]}
      {/* The delta is only shown when a direction is actually being claimed.
          "Stable +5" reads as a contradiction — the movement was below the
          threshold precisely because it does not mean anything. */}
      {direction !== 'stable' && delta !== null && delta !== 0 && (
        <span className="tabular font-normal">
          {delta > 0 ? '+' : ''}
          {delta}
        </span>
      )}
    </span>
  );
}

function TrendArrow({ direction }: { direction: 'improving' | 'stable' | 'declining' }) {
  if (direction === 'stable') {
    return (
      <svg viewBox="0 0 12 12" className="size-3" fill="none" aria-hidden="true">
        <path d="M2 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 12 12"
      className={cn('size-3', direction === 'declining' && 'rotate-180')}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 10V2m0 0L2.5 5.5M6 2l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
