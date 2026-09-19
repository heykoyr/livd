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

Two leaves, one behind the other: the symbol from the official logo, standing
on its own.

```text
viewBox   0 0 1000 1000     the artwork is centred; the frame carries its clear space
source    public/brand/logo/livd-symbol.svg   ·   -white.svg for dark grounds
```

It is the same drawing that sits before the word in the full logo, at the same
proportions, and is never redrawn, outlined, rotated, skewed, recoloured or
set inside a rounded tile.

**Where it stands in.** Only where the full logo will not fit or will not
read: a browser tab, a home screen, an adaptive launcher icon, an avatar. Every
surface with room for the wordmark uses the full logo.

---

## 2. Files

Every file below is **generated from the official artwork** by
`npm run brand:build`, then committed, so `next build` needs no image
toolchain:

| File | What it is | Made from |
| --- | --- | --- |
| `src/app/icon.svg` | The SVG favicon — carries both symbols, picks one | the two supplied symbol SVGs, paths copied verbatim |
| `src/app/favicon.ico` | Legacy fallback — 16, 32, 48 | the supplied `favicon-16/32/48.png`, packed in byte for byte |
| `src/app/apple-icon.png` | iOS home screen — 180×180, opaque | `livd-symbol.svg` on the paper field |
| `public/brand/icons/livd-icon-192.png` | Web app manifest | as above |
| `public/brand/icons/livd-icon-512.png` | Web app manifest, and the maskable icon | as above |

```bash
npm run brand:build
```

`tests/design/brand-icons.test.ts` asserts that each one still comes from the
official artwork — the favicon's paths against the supplied symbols, the ICO's
payloads against the supplied PNGs — so a redrawn symbol cannot ship to some
surfaces and not others.

Next.js wires the favicon, Apple icon and manifest from the `src/app/` file
conventions. There is deliberately no `icons` key in `layout.tsx` — a second
declaration would emit duplicate `<link>` tags.

---

## 3. Colour

The symbol's colours are part of the artwork and are not ours to choose. Two
supplied files, one per ground:

| Ground | File | Leaves |
| --- | --- | --- |
| Light — paper `#FBFAF8` | `livd-symbol.svg` | `#242624` and `#CECBC5` |
| Dark — night `#0D0E0D` | `livd-symbol-white.svg` | `#827C70` and white |

Nothing recolours the symbol: a dark ground gets the white **file**, never the
light file under a filter. The clay accent belongs to the wordmark's full stop
and appears nowhere in the symbol.

---

## 4. Size and clear space

**Minimum 16px**, which is the size the supplied `favicon-16.png` is drawn for
and the size the ICO carries.

The clear space is **in the file**: the symbol is centred on a 1000 unit frame
and reaches 46% of its width, so roughly a quarter of the artwork's height
stands clear on every side. Use the frame and add nothing — except in the
product, where `<Logo variant="symbol">` renders the fitted copy and the layout
owns the space, exactly as it does for the full logo.

---

## 5. Light and dark

`src/app/icon.svg` holds **both** supplied symbols and a `prefers-color-scheme`
rule displays one: the light-ground file on a light tab strip, the white file
on a dark one. Verified working in Chromium — the rendered favicon really does
change with the browser's colour scheme, rather than being assumed to.

This is the **one** place in the product that follows the browser's colour
scheme rather than the theme the visitor chose, and it is deliberate: the
favicon is drawn on the tab strip, which is the browser's surface and not
Livd's, so it has to suit the browser's chrome. A favicon cannot see the page's
`data-theme` in any case — it is a separate document. Everything drawn on the
page follows the chosen theme; see [`src/lib/theme.ts`](../src/lib/theme.ts).

Two things worth knowing rather than rediscovering:

- Chrome caches a rendered favicon, so a live theme switch may not repaint it
  until the next load. This is cosmetic and self-corrects.
- Safari's handling of the media query inside a favicon has **not** been
  verified here. A browser that ignores it draws the light-ground symbol, whose
  paler leaf stays legible on a dark strip — dim but present, not absent.

The rasters cannot carry a media query, so each is legible on either strip on
its own account: the symbol is two leaves, one dark and one pale, and whichever
ground it lands on, one of them contrasts with it.

`favicon.ico` carries the supplied PNGs unaltered, transparency included. The
**app icons are opaque**, on the paper field — iOS fills transparency with
black rather than ignoring it, which would put the symbol in a black box on a
home screen.

---

## 6. Using it in the product

```tsx
import { Logo } from '@/components/brand/logo';

<Logo variant="symbol" />              // follows the theme, like the full logo
<Logo variant="symbol" theme="dark" /> // a dark ground that is not the dark theme
```

There is no separate symbol component: one component renders the official
files, so there is one place to look and nothing to reimplement. It follows
the theme and names Livd in exactly the way the full logo does — see
[the logo](#in-the-product) above.

**It does not replace the logo.** `SiteHeader`, `SiteFooter` and the 404 use
the full logo. The symbol is an additional asset, not a substitution, and
nothing in the product renders it today: it exists for the tab, the home
screen and the launcher.
