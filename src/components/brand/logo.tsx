import { copy } from '@/content/copy';
import { cn } from '@/lib/utils';

/**
 * The files `<Logo>` renders, and the canvas each is drawn on.
 *
 * The official artwork lives in `public/brand/logo/` exactly as supplied.
 * These are the same files re-issued by `npm run brand:build` on a canvas
 * fitted to the artwork — the supplied frames carry empty margin a layout
 * cannot see — with every path unchanged. `tests/design/brand-logo.test.ts`
 * holds the paths to the masters and these sizes to the files.
 *
 * The width and height are the files' own. Passed to the `<img>`, they give
 * the browser the aspect ratio before the file arrives, so nothing moves when
 * it does.
 */
export const LOGO_ASSETS = {
  full: {
    light: { src: '/brand/fitted/livd-logo.svg', width: 722.657, height: 211.765 },
    dark: { src: '/brand/fitted/livd-logo-white.svg', width: 722.657, height: 211.766 },
  },
  symbol: {
    light: { src: '/brand/fitted/livd-symbol.svg', width: 455.883, height: 529.414 },
    dark: { src: '/brand/fitted/livd-symbol-white.svg', width: 455.883, height: 529.412 },
  },
} as const;

/**
 * Heights, matched to the type-set wordmark these replace: at `md` the "L" of
 * the drawn wordmark stands 14.3px, against the 14px cap height of the 20px
 * Newsreader it succeeds, so the header keeps its scale. The symbol takes the
 * same heights, which is the height it stands at inside the full logo.
 */
const HEIGHTS = {
  sm: 'h-5',
  md: 'h-6',
  lg: 'h-8',
} as const;

/**
 * The Livd logo — the official artwork, never a redrawing of it.
 *
 * `full` is the symbol and the wordmark together, and is what the header, the
 * footer and the 404 use. `symbol` is the symbol alone, for a space the full
 * logo will not fit.
 *
 * By default it follows the site theme: the dark-ink file on the light theme,
 * the white file on the dark one. Both are in the markup and `data-theme`
 * decides which is displayed, so the logo is right on first paint — the theme
 * script has set the attribute before anything is drawn — and swaps with the
 * toggle without a request, since both are already loaded. The one hidden by
 * `display: none` is out of the accessibility tree, so a screen reader meets
 * one logo, not two.
 *
 * Pass `theme` only for a surface whose ground does not follow the site theme:
 * `dark` is the white logo, for a dark ground; `light` is the dark-ink logo,
 * for a light one.
 *
 * The alt text is the name, because wherever the logo appears it is what says
 * "Livd". Inside a link with its own `aria-label`, that label wins, as it
 * should.
 */
export function Logo({
  variant = 'full',
  theme,
  size = 'md',
  className,
}: {
  variant?: 'full' | 'symbol';
  theme?: 'light' | 'dark';
  size?: keyof typeof HEIGHTS;
  className?: string;
}) {
  const art = LOGO_ASSETS[variant];

  // `className` goes before the theme classes so that nothing passed in — a
  // display utility, say — can undo the hiding of the other file.
  const image = (tone: 'light' | 'dark', display?: string) => (
    <img
      src={art[tone].src}
      width={art[tone].width}
      height={art[tone].height}
      alt={copy.brand.name}
      // Only on the pair that follows the theme, and only so that print can
      // pick the light-ground file: on paper the white one is nothing at all.
      // A logo pinned to a ground with `theme` is left alone, because hiding
      // it would print no logo rather than the wrong one.
      data-logo={display ? tone : undefined}
      className={cn('block w-auto shrink-0', HEIGHTS[size], className, display)}
    />
  );

  if (theme) return image(theme);

  return (
    <>
      {image('light', 'dark:hidden')}
      {image('dark', 'hidden dark:block')}
    </>
  );
}
