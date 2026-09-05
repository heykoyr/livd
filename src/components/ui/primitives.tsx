import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------
 * Surface
 * ---------------------------------------------------------------------- */

/**
 * The one card treatment in the product: hairline border, flat surface, 12px
 * radius. Structure comes from borders and tint, never from shadows.
 */
export function Card({
  as: Tag = 'div',
  interactive = false,
  className,
  children,
  ...props
}: {
  as?: ElementType;
  interactive?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<'div'>, 'children'>) {
  return (
    <Tag
      className={cn(
        'rounded-lg border border-border bg-surface',
        interactive &&
          'transition-colors duration-fast hover:border-border-strong hover:bg-surface-sunken/40',
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}

export function Section({
  title,
  description,
  action,
  id,
  className,
  headingLevel: Heading = 'h2',
  children,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  id?: string;
  className?: string;
  headingLevel?: 'h2' | 'h3';
  children: ReactNode;
}) {
  return (
    <section id={id} className={cn('scroll-mt-24', className)}>
      {(title || action) && (
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <Heading className="font-display text-title-lg tracking-tightish text-ink">
                {title}
              </Heading>
            )}
            {description && (
              <p className="mt-1 max-w-prose text-label text-ink-muted">{description}</p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------
 * Labels
 * ---------------------------------------------------------------------- */

export type BadgeTone =
  | 'neutral'
  | 'brand'
  | 'positive'
  | 'caution'
  | 'critical'
  | 'info'
  | 'accent';

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-ink-muted border-border',
  brand: 'bg-brand-soft text-brand-ink border-brand-border',
  positive: 'bg-positive-soft text-positive border-positive/25',
  caution: 'bg-caution-soft text-caution border-caution/25',
  critical: 'bg-critical-soft text-critical border-critical/25',
  info: 'bg-info-soft text-info border-info/25',
  accent: 'bg-accent-soft text-accent border-accent/25',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-micro font-medium',
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Uppercase micro label used above sections and beside figures. */
export function Eyebrow({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        'block text-micro font-semibold uppercase tracking-micro text-ink-subtle',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Chip({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: 'neutral' | 'positive' | 'problem';
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-label',
        tone === 'positive' && 'border-positive/25 bg-positive-soft text-positive',
        tone === 'problem' && 'border-caution/25 bg-caution-soft text-caution',
        tone === 'neutral' && 'border-border bg-surface-sunken text-ink-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * States
 * ---------------------------------------------------------------------- */

/**
 * Empty states carry weight in this product: a property with no reviews is a
 * common and legitimate outcome, and the page must say what it does not know
 * rather than looking broken.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-lg border border-dashed border-border-strong bg-surface-sunken/50 px-6 py-12 text-center',
        className,
      )}
    >
      {icon && <div className="mb-4 text-ink-subtle">{icon}</div>}
      <h3 className="font-display text-title-md tracking-tightish text-ink">{title}</h3>
      <p className="mt-2 max-w-md text-balance text-body text-ink-muted">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md bg-surface-sunken',
        // The shimmer is decorative; reduced-motion collapses it globally.
        'after:absolute after:inset-0 after:-translate-x-full after:animate-[livd-shimmer_1.6s_infinite] ' +
          'after:bg-gradient-to-r after:from-transparent after:via-border/60 after:to-transparent',
        className,
      )}
      aria-hidden="true"
    />
  );
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

/* -------------------------------------------------------------------------
 * Data display
 * ---------------------------------------------------------------------- */

/**
 * A horizontal bar for a 0–100 value.
 *
 * The value is always rendered as text beside the bar, so the bar is
 * reinforcement rather than the sole carrier of meaning.
 */
export function Meter({
  value,
  max = 100,
  tone = 'brand',
  label,
  className,
}: {
  value: number;
  max?: number;
  tone?: 'brand' | 'strong' | 'good' | 'mixed' | 'weak' | 'poor' | 'unknown';
  label: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));

  const fills: Record<string, string> = {
    brand: 'bg-brand',
    strong: 'bg-score-strong',
    good: 'bg-score-good',
    mixed: 'bg-score-mixed',
    weak: 'bg-score-weak',
    poor: 'bg-score-poor',
    unknown: 'bg-score-unknown',
  };

  return (
    <div
      role="meter"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-slow', fills[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn('border-0 border-t border-border', className)} />;
}

/** Key/value pair used in headers and comparison tables. */
export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-1 text-title-md tabular text-ink">{value}</dd>
      {hint && <p className="mt-0.5 text-micro text-ink-subtle">{hint}</p>}
    </div>
  );
}
