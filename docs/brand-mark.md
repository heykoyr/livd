# Livd — The Brand Mark

The official Livd logo — the symbol and the **Livd.** wordmark together — is
supplied artwork, and the product renders those files rather than drawing
anything of its own. This documents where they live and how they are used, and
the symbol that stands in where the logo cannot: a browser tab, a home screen,
an avatar, a notification.

---

## The official logo

### Files

`public/brand/logo/` holds the official files **exactly as supplied**. Nothing
in the build writes to it, and nothing may edit it: never redraw, re-export,
recolour, stretch, crop, rotate, filter or shadow the logo.

| File | What it is |
| --- | --- |
| `livd-logo.svg` | The full logo — symbol and wordmark — for light grounds |
| `livd-logo-white.svg` | The full logo for dark grounds |
| `livd-symbol.svg` | The symbol alone, for light grounds |
| `livd-symbol-white.svg` | The symbol alone, for dark grounds |
| `*.png`, `*@2x.png` | Raster exports of each, for places that cannot take SVG |

`public/brand/favicon/` holds the supplied favicon set: `favicon-16`, `-32`
and `-48`, each as SVG, PNG and `@2x` PNG.

Colour is part of the artwork. The light-ground files use `#242624` and
`#CECBC5` for the symbol, black for the word and clay `#AA5329` for the full
stop; the dark-ground files use `#827C70` and white, with the same clay stop.

### Fitted copies

The supplied SVGs are exported on fixed frames — the logo on 1600 × 400 with
its artwork in the left half, the symbol centred on 1000 × 1000. A layout sees
the frame, not the drawing, so the logo rendered as supplied would carry 87px
of transparent canvas after the full stop in the header.

`npm run brand:build` therefore re-issues each SVG into `public/brand/fitted/`
on a canvas fitted to its artwork: the root element's `width`, `height` and
`viewBox` change and **nothing else does**. `tests/design/brand-logo.test.ts`
fails if a single path differs from its master, or if a fitted canvas clips
any point of the drawing — checked by sampling every curve, independently of
the script's own arithmetic.

Clear space is the layout's job, as it was for the type-set wordmark these
replace.

### In the product

Always through `<Logo>` — never an `<img>` written by hand, and never the
wordmark set as text.

```tsx
import { Logo } from '@/components/brand/logo';

<Logo />                      // the full logo, following the site theme
<Logo variant="symbol" />     // the symbol alone, where the logo will not fit
<Logo theme="dark" />         // a surface whose ground does not follow the theme
<Logo size="lg" />            // sm 20px · md 24px (default) · lg 32px tall
```

**Theme.** Both files are in the markup; the `dark:` variant, which keys on
`data-theme`, displays one and hides the other. So the logo is right on first
paint (the theme script sets the attribute before anything is drawn), swaps
with the toggle without a request, and needs no theme logic of its own. It is
never recoloured with a filter — the white logo is its own file.

**Size.** `md` is 24px tall, which puts the wordmark's "L" at 14.3px against
the 14px cap height of the 20px Newsreader wordmark it replaced, so the header
kept its scale.

**Accessibility.** Each file carries `alt="Livd"`, and the hidden one is
`display: none` and so out of the accessibility tree. Inside the header's home
link, the link's own `aria-label` ("Livd — home") names it.

**Where it is used.** `SiteHeader`, `SiteFooter` and `global-not-found.tsx`.

**Not yet.** The Open Graph and Twitter cards
(`src/app/opengraph-image.png`, `twitter-image.png`) are static images that
still show the type-set wordmark; they need re-rendering with the official
logo as a separate piece of design work. Email templates set the wordmark as
type on purpose — images are blocked by default in most clients, and none of
them render SVG.

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

**It does not replace the logo.** `SiteHeader` and `SiteFooter` continue to
use `<Logo>`. The mark is an additional asset, not a substitution.
