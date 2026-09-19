import { THEME_SCRIPT } from '@/lib/theme';

/**
 * The saved theme, applied before first paint — see `THEME_SCRIPT`.
 *
 * Belongs at the end of `<head>` in every document Livd renders, and there are
 * two: the root layout, and `global-not-found.tsx`, which owns its own
 * `<html>`. Without it there, anyone who had chosen dark was shown a light 404.
 */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
