# Livd — Build Roadmap

Each phase ended with tests passing, a typecheck, a production build and a
commit.

---

## Delivered

### Phase 0 — Audit & specification ✅
Environment audit, stack selection, repository initialised, five specification
documents, toolchain pinned to the local Node version with zero engine
warnings.

### Phase 1 — Foundation ✅
Design tokens and global styles · typography · UI primitives · app shell and
responsive navigation · the two-adapter data layer · authentication adapters
and route guards · error and loading states · centralised copy · `Intl`
formatting for twelve markets · complete PostgreSQL schema with RLS.

### Phase 2 — Property discovery ✅
Landing page · search with suggestions, fuzzy matching and typo tolerance ·
results with filters and sorting · property cards · location index pages ·
metadata, JSON-LD, sitemap and robots.

### Phase 3 — Property intelligence ✅
Livd Score with recency decay, verification weighting and Bayesian shrinkage ·
confidence bands · category scores · resident verdict · "Why residents leave" ·
trend detection · timeline · "Check before you visit" · review list with
filtering and sorting.

### Phase 4 — Contribution ✅
Nine-step review wizard with progressive disclosure · property picker and
"add a property" path · structured ratings, tags and departure reasons ·
validation · content safety pipeline at submission · confirmation · edit
window.

### Phase 5 — Trust & safety ✅
Report flow · moderation queue and admin area · rate limiting · duplicate
prevention · property claims · owner responses · append-only audit trail ·
verification levels feeding the score.

### Phase 6 — Personalisation ✅
Account · my reviews with the edit window shown · saved properties · shortlist
comparison.

### Phase 7 — Polish ✅
axe-core audit against a production build, four violations fixed · contrast
verified in both themes against real computed styles · mobile pass · every
route checked · production guards corrected.

---

## Known limitations

**Soft 404 on an unknown property slug.** Next 16 renders a not-found boundary
outside the root layout, in a document with no `lang` attribute and no site
chrome. Verified in a production build that no arrangement of `not-found.tsx`
or `global-not-found.tsx` changes this. The property route therefore renders
its missing state inline with `noindex` — trading the 404 status for a page
that is readable and accessible. Revisit when the framework renders the
boundary inside the layout.

**Verification is a framework, not yet a pipeline.** The levels exist, weigh
the score correctly, and are settable by a moderator. The evidence upload and
automated checks behind `verified_resident` are the next piece of work.

**Rate limiting is in-process.** Correct for a single-region MVP, wrong for
multiple instances. `RateLimitStore` exists so this becomes a Postgres or Redis
implementation without touching a call site.

**Burst detection is specified, not implemented.** The schema and the plan are
in `docs/architecture.md` §7; the scheduled job is not written.

---

## Next

**Before launch.** Verification pipeline · Postgres-backed rate limiting ·
burst detection job · legal review of the three policy pages in each launch
market · an email provider for magic links · error monitoring.

**Soon after.** Privacy-safe map discovery, area-level rather than unit-level ·
grounded AI summarisation of review corpora, behind the existing
`VerdictGenerator` interface · rent trend intelligence · property manager
profiles · additional locales, which the copy layer is already structured for.

**Deferred on purpose.** Messaging between users · mobile applications ·
payments · any monetisation that creates an incentive to distort what residents
reported.
