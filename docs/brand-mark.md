# Livd — The Brand Mark

The wordmark **Livd.** remains the primary signature and is unchanged. This
documents the symbol that stands in where the wordmark cannot: a browser tab, a
home screen, an avatar, a notification.

---

## 1. The mark

A square mass, rounded where it turns and carved where it opens.

One radius, used twice. The top-left corner is rounded at **20**; the
bottom-right is removed by a circle of **23** centred on the corner itself. The
two are unequal on purpose — a concave curve reads tighter than a convex one of
the same radius, so they have to differ on paper to look equal on screen.

```text
viewBox   0 0 48 48        the mark fills the box; consumers own the padding
path      M0 20A20 20 0 0 1 20 0h28v25a23 23 0 0 0-23 23H0z
```

**What it means.** A place is a solid. Living in one leaves a trace. That is the
whole of what Livd records — somewhere that held someone, and the space they
left in it.

**What it is not.** Not a house, a roof, a key, a door, a pin or a heart. Those
are the shelf every property product is already on. It is also not a monogram:
a letter beside a wordmark that contains the same letter is a redundancy, not a
symbol.

**Relationship to the wordmark.** The wordmark's one piece of drawn geometry is
the clay full stop after the word. The mark is built from the same vocabulary —
a single circular radius against straight type — so the two read as one
identity without the mark repeating the word.

---

## 2. Files

| File | What it is |
| --- | --- |
| `public/brand/livd-mark.svg` | **The master.** Single path, `currentColor`, no background. Source of truth for everything below. |
| `public/brand/livd-app-icon.svg` | App icon master — mark on the paper field |
| `public/brand/livd-app-icon-dark.svg` | Reversed, for dark grounds and press use |
| `public/brand/livd-icon-192.png` | Web app manifest |
| `public/brand/livd-icon-512.png` | Web app manifest |
| `public/brand/livd-icon-maskable-512.png` | Android adaptive icon |
| `src/app/icon.svg` | The SVG favicon — theme-aware |
| `src/app/favicon.ico` | Legacy fallback — 16, 32, 48 |
| `src/app/apple-icon.png` | iOS home screen — 180×180 |
| `src/components/brand/mark.tsx` | `<Mark>` for use inside the product |

The rasters are **generated, then committed**, so `next build` needs no image
toolchain:

```bash
npm run brand:build
```

`tests/design/brand-mark.test.ts` asserts that the master, the component and
every generated file still draw the same geometry, so a redrawn mark cannot
ship to some surfaces and not others.

Next.js wires the favicon, Apple icon and manifest from the `src/app/` file
conventions. There is deliberately no `icons` key in `layout.tsx` — a second
declaration would emit duplicate `<link>` tags.

---

## 3. Colour

Monochrome by design. The mark carries no colour of its own and nothing about
it is communicated by colour alone.

| Ground | Mark | Token |
| --- | --- | --- |
| Paper `#FBFAF8` | Evergreen `#12312A` | `--color-brand`, light |
| Night `#0D0E0D` | Sage `#D8E4DE` | `--color-brand`, dark |
| Any | Ink `#17191A` or paper `#FBFAF8` | one-ink printing, embroidery, favicons |

The clay accent is **not** used for the mark. It belongs to the wordmark's full
stop, and a mark that depended on it would fail in one ink.

---

## 4. Size and clear space

**Minimum 16px.** Verified at 16, 20, 24, 32 and 48 by rasterising and
inspecting the actual pixels, not by scaling a large version down.

Clear space on all four sides is **one quarter of the mark's height**. Measure
it from the bounding box, not from the curves.

Never redraw, outline, rotate, skew, add a shadow to, or place the mark inside a
rounded tile. It is itself a square: a tile around it reads as a window rather
than as a logo, which is why the favicon is bare.

---

## 5. Light and dark

`src/app/icon.svg` carries a `prefers-color-scheme` rule and swaps evergreen for
sage. Verified working in Chromium — the computed fill really does change with
the browser's colour scheme, rather than being assumed to.

Two things worth knowing rather than rediscovering:

- Chrome caches a rendered favicon, so a live theme switch may not repaint it
  until the next load. This is cosmetic and self-corrects.
- Safari's handling of the media query inside a favicon has **not** been
  verified here. If a browser ignores it, the mark renders evergreen on a dark
  tab strip — dim but still present, not absent. That is the reason the light
  default is the darker of the two and not the paler one.

`favicon.ico` and every PNG are **opaque**, on the paper field. They cannot
carry a media query, so they have to be legible against a dark tab strip on
their own; and iOS fills transparency with black rather than ignoring it, which
would put the mark in a black box on a home screen.

---

## 6. Using it in the product

```tsx
import { Mark } from '@/components/brand/mark';

<Mark className="size-5 text-brand" />          // decorative, beside the wordmark
<Mark label="Livd" className="size-8" />        // the only thing naming Livd
```

It inherits `currentColor` and is `aria-hidden` unless given a `label`.

**It does not replace the wordmark.** `SiteHeader` and `SiteFooter` continue to
use `<Logo>`. The mark is an additional asset, not a substitution.

---

## 7. Not done here

The OpenGraph and Twitter images still use the wordmark alone, which is correct
for a 1200×630 card where there is room for it. The mark is now available as a
reusable source asset if they are ever revisited.
