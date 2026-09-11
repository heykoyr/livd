# Livd — Design System

Tokens live in `src/app/globals.css` under Tailwind v4's `@theme`. Components
reference tokens only. Arbitrary values are treated as a defect.

---

## 1. Principle

Livd is a **record**, not a marketplace. The interface should feel like a
well-set reference work: quiet, precise, generous with whitespace, confident
enough to leave things out.

Three rules that most decisions fall out of:

1. **Hairlines, not shadows.** Structure comes from 1px borders and surface
   tint. Exactly one elevation exists, reserved for overlays.
2. **One accent, spent carefully.** Colour marks meaning — a score, a warning, a
   single primary action per view. Decorative colour is not used.
3. **Type carries the hierarchy.** If a layout needs a box to be legible, the
   typography is wrong.

Explicitly avoided: gradient heroes, glassmorphism, oversized pill buttons,
stock illustration, drop shadows on cards, purple-to-blue SaaS palettes,
emoji as iconography, dense dashboard chrome.

---

## 2. Typography

Two families, self-hosted through `next/font` — no external font requests.

| Role | Family | Notes |
| --- | --- | --- |
| Display | **Newsreader** (variable serif) | Headlines and section openers only. Editorial, calm, and it reads as a document of record rather than a marketing page. |
| Interface & data | **Inter** (variable) | All UI, body, labels and numerals. Chosen for genuinely broad language coverage — a requirement, not a preference, for a product that will localise. |

Numerals use `font-variant-numeric: tabular-nums` wherever figures align in a
column, so scores and counts do not shift between rows.

### Scale

Fluid via `clamp()`; ratio ≈ 1.25 at small sizes, opening to ≈ 1.33 for display.

| Token | Size | Use |
| --- | --- | --- |
| `display-xl` | 3.25–4.75rem | Landing hero |
| `display-lg` | 2.5–3.25rem | Page titles |
| `display-md` | 1.875–2.25rem | Property name |
| `title-lg` | 1.375rem | Section headings |
| `title-md` | 1.125rem | Card titles |
| `body-lg` | 1.0625rem | Review prose |
| `body` | 0.9375rem | Default |
| `label` | 0.8125rem | Form labels, metadata |
| `micro` | 0.75rem | Chips, captions — uppercase, `0.06em` tracking |

Measure is capped at `68ch` for prose. Display text sets at `-0.02em` tracking
and `1.05` leading; body at `1.6`.

---

## 3. Colour

Geographically neutral by design — no national palettes, no flags, no
continent-coded imagery. The palette is warm-neutral paper and ink with a single
evergreen brand and a clay accent.

### Neutrals

| Token | Light | Dark |
| --- | --- | --- |
| `canvas` | `#FBFAF8` | `#0D0E0D` |
| `surface` | `#FFFFFF` | `#161816` |
| `surface-sunken` | `#F4F2EE` | `#111311` |
| `border` | `#E5E1D9` | `#2A2D2A` |
| `border-strong` | `#CFC9BD` | `#3C403C` |
| `ink` | `#17191A` | `#F2F1ED` |
| `ink-muted` | `#5C5F5B` | `#A3A69F` |
| `ink-subtle` | `#6D7069` | `#83867F` |

### Brand and accent

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `brand` | `#12312A` | `#D8E4DE` | Primary buttons, logotype, focus |
| `brand-hover` | `#0C241F` | `#C3D5CD` | |
| `brand-soft` | `#E8EFEB` | `#1C2E28` | Selected states, quiet fills |
| `accent` | `#AA5329` | `#E09365` | Emphasis and data highlight — used sparingly |

Deep evergreen reads as considered and institutional without the eco cliché a
mid-tone green carries. Clay supplies warmth without tipping into alarm.

### Sentiment scale

Used for scores and category bars. Ordered so it survives monochrome printing and
the common colour-vision deficiencies; never the sole carrier of meaning — every
score is also stated numerically and in words.

| Token | Light | Meaning |
| --- | --- | --- |
| `score-strong` | `#2C6B58` | 80–100 |
| `score-good` | `#4C754C` | 65–79 |
| `score-mixed` | `#876923` | 50–64 |
| `score-weak` | `#9C5B33` | 35–49 |
| `score-poor` | `#A34430` | 0–34 |

### Status

`positive #2C6B58` · `caution #9A6B18` · `critical #A34430` · `info #35566B`,
each with a soft background variant.

Dark mode is a full token remap, not an inversion.

**Contrast.** Every pair the design actually puts together is asserted in
`tests/design/contrast.test.ts`, which reads the values out of `globals.css` so
the check cannot drift from the palette: body text at 4.5:1 on all four neutral
surfaces, each tone on its own soft background, each score band on the tint its
rating pill uses, and the focus ring at 3:1.

Two rules fall out of that and are worth stating rather than rediscovering:

- **`ink-subtle` is for neutral surfaces only.** It is the third step of the
  neutral scale, and on every soft tint it lands between 3.9:1 and 4.5:1.
  Pushing it far enough to clear them would collapse it into `ink-muted`. A chip
  that needs secondary neutral text uses `ink-muted`, which clears every tint
  comfortably.
- **Opacity is not a shade.** `opacity-70` on coloured text blends it toward
  whatever is behind it; two places did this and measured 2.6:1. Reach for a
  token, or a different weight.

These values were retuned once, in September 2026, after axe was first run in a
real browser rather than through jsdom. Six tokens had been below 4.5:1 since
the palette was written. Hue and saturation were held constant; only lightness
moved, by the least each needed.

---

## 4. Space, radius, elevation

**Space** — 4px base: `0.5 · 1 · 1.5 · 2 · 3 · 4 · 6 · 8 · 12 · 16 · 24` units.
Section rhythm is `4rem` mobile, `6rem` desktop.

**Radius** — `xs 4` · `sm 6` · `md 8` · `lg 12` · `xl 16` · `full`.
Cards use `lg`. `full` is reserved for chips and avatars. No 24px+ cards.

**Elevation** — one shadow only:
`0 1px 2px rgb(23 25 26 / 0.04), 0 12px 32px -8px rgb(23 25 26 / 0.12)`, for
dialogs, sheets, popovers and toasts. Cards use borders.

**Grid** — 12 columns, `1.5rem` gutter, `max-w-[76rem]` container; prose columns
cap at `40rem`.

---

## 5. Components

What is built, not what was planned. A primitive is added when a second surface
needs it; until then the surface owns its own markup.

`ui/` — **Button** (primary · secondary · ghost · danger · quiet; sm/md/lg;
loading and disabled states) · ButtonLink · IconButton · Spinner ·
**Field** (label, hint, error, `aria-describedby` wiring) · Input · Textarea ·
Select · CharacterCount · FormError · **RadioCardGroup** · CheckboxChipGroup ·
RatingScale · RatingLegend · SegmentedControl · **Dialog** (focus trap and
restoration) · Toast · Pagination · Card · Section · Badge · Chip · Eyebrow ·
Meter · Stat · Divider · EmptyState · Skeleton · VisuallyHidden ·
**DataTable**.

**DataTable** is the one primitive that renders twice. Columns are declared
once; from `lg` it is a real `<table>`, below it a stack of cards with each
value under its own label. Both representations are always in the DOM and
`display: none` keeps exactly one of them in the accessibility tree. It exists
because the two administrative tables — accounts and sanctions — were a
46rem table in a scroll container, which made the page survivable on a phone
without making the data readable.

`property/` — **ScoreDial** · ConfidenceChip · ScoreBadge · TrendPill ·
**ResidentVerdictPanel** · CategoryScores · **DepartureBreakdownPanel** ·
PreVisitChecks · PropertyTimeline · TagFrequencyList · ResidentFreshnessPanel ·
FreshnessLine · PropertyHeader · PropertyCard · PropertyMissing · ReviewCard ·
ReviewFilters · ReportReviewButton · SaveButton · ShareButton ·
**VerifyLocation** · VerificationBadge · VerifyResidency.

`search/` — SearchCombobox · SearchFilters · NearbyProperties.
`layout/` — SiteHeader · SiteFooter · MobileNav · AccountMenu · ThemeToggle ·
ProsePage. `brand/` — Logo.

The review wizard's steps and the shortlist comparison table live beside the
routes that own them, in `src/app/review/` and `src/app/shortlist/`, because
nothing else renders them.

Not built: Tabs, Tooltip, Progress and Disclosure. Each was in the original
inventory and none earned its place — the surfaces that would have used them
were solved with a heading, a link, or a native `<details>`.

Every interactive primitive: 44×44px minimum hit *area*, visible
`:focus-visible` ring (2px `brand`, 2px offset), disabled states that still
meet 3:1, and a non-colour indicator for every state.

**Hit area, not box size.** A compact icon button in a 64px header and a
"Report" link set in `micro` are both correct as drawn, and were 36 and 15
pixels tall to a thumb — measured in a real phone viewport, the admin console
had 47 controls under 44px. The `tap-target` utility in `globals.css` grows
the target from the control's own centre with a pseudo-element, so nothing
moves, resizes or restyles. It is declared with `@utility` rather than as a
class in `@layer utilities`, because only the former composes with a variant:
`[&_a]:tap-target` is how `DataTable` reaches a link inside a cell whose
markup it does not own, and a plain class silently does nothing there.

It is not for dense stacks. The footer's link columns sit 34px apart, so a
44px box would make neighbours overlap — a worse outcome than a small target.
Those links carry `-my-2 py-2` instead, which doubles the target to 31px with
no visual change at all, and they clear WCAG 2.2 AA through the
undersized-target spacing exception either way.

---

## 6. Motion

Durations `120 / 180 / 240ms`; easing `cubic-bezier(0.2, 0, 0, 1)` for entrances,
`cubic-bezier(0.4, 0, 1, 1)` for exits.

Motion is used only to explain a state change: results replacing results, a step
advancing, a sheet's origin, a save confirming. Nothing animates on scroll.
Nothing animates decoratively.

`@media (prefers-reduced-motion: reduce)` collapses every transition to `0.01ms`
globally and replaces movement with opacity where a transition still aids
comprehension.

---

## 7. Responsive

Mobile-first and mobile-designed, not scaled down.

`sm 640 · md 768 · lg 1024 · xl 1280`

Deliberate mobile divergences: search becomes a full-screen overlay with the
keyboard-safe result list · filters become a bottom sheet · the review wizard is
one full-height step with a fixed footer action · the comparison table becomes
horizontally scrolled with a pinned first column · the property page's category
bars stack and the score dial moves inline with the header · the admin console's
grouped sidebar becomes one disclosure labelled with the page you are on · its
tables become card stacks.

**No page scrolls sideways.** Intentional horizontal scrolling exists in exactly
two places — the shortlist comparison and the review filter chips — and both
are the right pattern for what they hold. Everywhere else a sideways scrollbar
is a bug, and it is almost always the same bug: a `grid` whose column
definition only exists above a breakpoint. Below it the single implicit track
is `auto`, which sizes to content rather than to the container, and a scroll
container inside it does not help — it still contributes its intrinsic width
upward. Every responsive grid therefore carries a base `grid-cols-…`, and
`tests/design/responsive.test.ts` fails the build if one does not.
`overflow-x: hidden` on the root is not a remedy and the same test refuses it:
it hides the symptom and takes the content that overflowed with it.

---

## 8. Voice

Plain, exact, unhurried. Sentence case everywhere including buttons. No
exclamation marks. No "Oops". No "Awesome". Numbers stated with their basis
("Based on 23 reviews"). Empty states say what is missing and what the reader can
do about it. Errors say what happened, then the next step.
