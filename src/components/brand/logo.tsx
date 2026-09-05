import { cn } from '@/lib/utils';

/**
 * The Livd mark.
 *
 * A wordmark rather than a symbol. A young brand with no recognition to trade
 * on is better served by its name set well than by an abstract glyph nobody can
 * yet attach meaning to.
 *
 * The dot after the word does the work: it reads as a full stop — a statement,
 * a record, something settled — which is precisely the product's posture. It is
 * drawn rather than typed so it holds its weight and position at every size.
 */
export function Logo({
  className,
  size = 'md',
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = {
    sm: 'text-[1.0625rem]',
    md: 'text-[1.25rem]',
    lg: 'text-[1.75rem]',
  };

  const dotSizes = {
    sm: 'size-[3px] mb-[2px]',
    md: 'size-[3.5px] mb-[2.5px]',
    lg: 'size-[5px] mb-[3px]',
  };

  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-[0.09em] font-display font-medium tracking-[-0.03em] text-ink',
        sizes[size],
        className,
      )}
    >
      Livd
      <span aria-hidden="true" className={cn('inline-block rounded-full bg-accent', dotSizes[size])} />
    </span>
  );
}
