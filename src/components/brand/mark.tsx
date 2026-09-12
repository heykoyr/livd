import { cn } from '@/lib/utils';

/**
 * The path the Livd mark is drawn from, on a 48 unit box it fills exactly.
 *
 * One radius used twice. The top-left corner is rounded at 20; the bottom-right
 * is carved away by a circle of 23 centred on the corner itself. Concave curves
 * read tighter than convex ones of the same radius, so the two are unequal on
 * paper in order to look equal on screen.
 *
 * `public/brand/livd-mark.svg` is the master this must stay identical to —
 * every raster icon is rendered from that file, and
 * `tests/design/brand-mark.test.ts` fails if the two ever disagree.
 */
export const MARK_PATH = 'M0 20A20 20 0 0 1 20 0h28v25a23 23 0 0 0-23 23H0z';

/**
 * The Livd mark: the symbol, without the wordmark.
 *
 * A place is a solid. Living in one leaves a trace — the mark is a square that
 * has been rounded where it turns and opened where it lets go, which is the
 * whole of what Livd records: somewhere that held someone, and the space they
 * left in it. It is not a house, and deliberately so; the shelf of property
 * products drawn as a roof with a chimney is already full.
 *
 * Not a replacement for {@link Logo}. The wordmark stays the primary signature
 * wherever there is room for it, and this stands in only where there is not —
 * a browser tab, a home screen, an avatar.
 *
 * Drawn in `currentColor` and carrying no colour of its own, so it inherits the
 * theme like any other glyph and survives being printed in one ink.
 */
export function Mark({
  className,
  label,
}: {
  className?: string;
  /** Give this only where the mark is the sole thing naming Livd. Beside the
   *  wordmark it is decoration, and stays out of the accessibility tree. */
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={cn('size-6', className)}
      fill="currentColor"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={MARK_PATH} />
    </svg>
  );
}
