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

### Deployment ✅
Supabase project provisioned, the eight migrations that existed at the time
applied, and the demonstration data loaded into it — 16 properties, 222 reviews and 3,558 child rows, every
one marked `is_demo`. Deployed to Vercel at
<https://livd-koyrstudio.vercel.app>, rebuilding on every push to `main`.
Verified against the live site: every public route 200, every authenticated
route redirecting to sign-in, canonical and OpenGraph URLs on the real origin,
no seeded property in the sitemap and every one of them `noindex`, and zero
axe violations across thirteen pages.

### Phase 8 — Property verification & resident trust ✅
A resident can confirm they are at a property before writing, and the review
carries "Location verified" — the honest claim, since presence at a building is
not proof of a tenancy and the product never says it is. The decision is made
inside Postgres by `livd_verify_property_location`, so a client can ask for a
verdict and never assert one; `livd_derive_review_verification` derives a
review's level from the verification it points at and refuses one belonging to
another person or another property. No coordinate is stored anywhere: a
position is an argument to a function and is gone when it returns.

Resident recency is derived rather than stored — current, recent, former,
older — so nobody verifies once and stays a "current resident" for ever, and
the property page says how representative its evidence is of living there
today. Optional keyless geocoding gives newly added properties a coordinate.
Opt-in "properties near you" on search, which asks for nothing until it is
pressed. Migrations 0013–0016.

It also closed a hole that predated it: `reviews` accepted an INSERT with any
`verification_level` the client chose, so anyone holding the public anon key
could publish a review at 1.8× weight with a "Verified" badge on it.

---

## Known limitations

**Soft 404 on an unknown property slug.** Next 16 renders a not-found boundary
outside the root layout, in a document with no `lang` attribute and no site
chrome. Verified in a production build that no arrangement of `not-found.tsx`
or `global-not-found.tsx` changes this. The property route therefore renders
its missing state inline with `noindex` — trading the 404 status for a page
that is readable and accessible. Revisit when the framework renders the
boundary inside the layout.

**Account deletion, and the promise it had to keep.** All three legal pages
said a deleted account leaves its reviews standing, permanently unlinked.
`reviews.author_id` was `on delete cascade`, so deletion would have removed
them. Migration 0017 severs instead of deleting across every link to a profile
— reviews, owner replies and the moderation record survive unattributed, while
the shortlist, notifications, location checks and residency documents are
destroyed. 0018 exists because 0017 alone silently made deletion impossible: a
foreign key setting `author_id` to null is an UPDATE, and the guard trigger
that stops authors rewriting reviews refused it. Only a live test caught that.

---

## Next

**Before launch.** An email provider · error monitoring · a legal entity, a
contact route and counsel's review of the three policy pages.

The email provider is no longer what blocks people from signing in — Google
sign-in is live and does not email anything. It is still needed to make the
email link usable, because the link is single-use and Gmail's scanner spends it
about fifteen seconds after delivery, and only custom SMTP unlocks the setting
that would let that email send a typed code instead.

The other four pre-launch items are done:

- **Signing in works.** `thefirstadekoya@gmail.com` is the first account on Livd
  to hold a session, through Google. Every account before it shows email
  confirmed and no session ever created. Both providers land on the same profile
  when the address matches, so nobody ends up with two accounts.
- **Verification is a pipeline.** A resident uploads at `/account/reviews`,
  `src/lib/safety/verification-checks.ts` settles what a machine can settle, and
  a moderator decides at `/admin/verification`. Evidence lives in a private
  bucket with no policy for any client role and reaches a moderator through a
  five-minute signed URL. Nothing grants a level automatically. Migration 0012.
- **Rate limiting counts in Postgres**, on a sliding window under a per-actor
  advisory lock, rather than once per warm serverless instance. Falls back to
  in-process counting if the store is unreachable, because a database blip
  should not stop every write in the product. Migration 0009.
- **Burst detection runs hourly on pg_cron**, comparing each property against
  its own rate rather than a global constant, and raising flags at
  `/admin/flags` that no code ever acts on. Migrations 0010 and 0011.

The legal item cannot be finished here — it needs counsel in each market — so
what exists instead is `docs/legal-review.md`: the brief they would otherwise
spend a day assembling, plus the disclosures that are visibly absent and the
three questions specific enough to this product that a template will not answer
them. Two of its findings are engineering work, not legal work: the erasure
contradiction above, and the fact that several policy promises point at a
contact route the product does not have.

Still true since the deployment:

- **`SUPABASE_SERVICE_ROLE_KEY` is not set**, on Vercel or locally. Visitors are
  unaffected — every public read and every submission goes through RLS as the
  anon or authenticated role — but `/admin` cannot act on the moderation queue
  until it is added.
- **Custom SMTP is the last thing standing between the auth email and the
  product.** The magic-link flow itself is fixed and live — Site URL, callback,
  session refresh, all verified on 7 September 2026. But Supabase's built-in
  sender disables the Subject and Body fields outright, so the branded template
  in `supabase/templates/magic-link.html` cannot be applied and the sender still
  reads "Supabase Auth". One setting gates all three, and it needs a domain Livd
  controls with SPF and DKIM. The built-in sender is also rate-limited to a few
  emails an hour and is not something to launch on.
- **`LIVD_SHOW_DEMO_DATA=true` in production**, which is what makes the seeded
  properties visible at all. It has to be turned off the moment real reviews
  exist, or the two will sit side by side.

**Geocoding coverage.** Three providers behind one interface — Google, Mapbox
and Nominatim — configured as an ordered list so a commercial provider can fall
back to the free one. Every provider passes the same precision gate: anything
less precise than a building is refused, because a wrong coordinate offers a
verification step a real resident cannot pass while a missing one offers no step
at all. `npm run geocode:backfill` fills in properties that predate the
geocoder. Google and Mapbox are covered by fixture tests in their real response
shapes but have not been exercised against their live APIs, which needs paid
keys.

**Soon after.** Privacy-safe map discovery, area-level rather than unit-level ·
grounded AI summarisation of review corpora, behind the existing
`VerdictGenerator` interface · rent trend intelligence · property manager
profiles · additional locales, which the copy layer is already structured for.

**Livd Pulse**, the natural next use of the verification model rather than a
new one: a verified current resident answers a handful of category prompts —
noise, maintenance, water, security, internet, neighbours, management, value —
without writing a full review, and their answer refreshes how current the
property's picture is. The pieces it needs already exist.
`property_verification_method` has room for it, `residentRecency` already takes
an explicit reference date so a check-in can move a review's recency without
rewriting the review, and `ResidentFreshness` is the shape a Pulse panel would
read. What is deliberately absent is any of the scoring: a Pulse response is
not a review and must not be folded into the Livd Score without its own
thinking about weight and abuse.

**Verification methods beyond location.** `property_verification_method`
already declares `lease`, `utility`, `landlord` and `invitation`. Each would
produce the same record with a different level attached, and each needs its own
decision about who adjudicates — which is why none is implemented rather than
half-implemented.

**Deferred on purpose.** Messaging between users · mobile applications ·
payments · any monetisation that creates an incentive to distort what residents
reported.
