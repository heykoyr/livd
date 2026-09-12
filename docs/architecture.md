# Livd — Technical Architecture

---

## 1. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | **Next.js 16 (App Router)** | Property pages must be server-rendered and indexable — SEO is the primary acquisition channel. Server Components keep the intelligence layer on the server and off the client bundle. |
| Language | **TypeScript**, `strict` + `noUncheckedIndexedAccess` | The scoring maths and safety pipeline are where correctness matters most. |
| UI | **React 19** | Server Components, Actions, `useActionState` for progressive-enhancement-friendly forms. |
| Styling | **Tailwind CSS v4** with a CSS-variable token layer | Tokens are declared once in `@theme`; components never use arbitrary values. |
| Database | **PostgreSQL** (via Supabase) | Relational integrity, real constraints, RLS, full-text search, `pg_trgm` fuzzy matching. |
| Auth | **Supabase Auth** — magic link + OAuth | No passwords to store or leak. |
| Validation | **Zod v4** | One schema per boundary, shared by client hints and server enforcement. |
| Tests | **Vitest** + Testing Library + axe-core | |
| Email | **Resend**, over `fetch` | Transactional only. An HTTPS POST with a JSON body — no dependency, no long-lived connections for a serverless platform to mishandle, and failures that arrive as a status code. |
| Bot mitigation | **Cloudflare Turnstile** | Invisible for almost every real person, and not an advertising product. Verified server-side; the requirement is decided from the server's own environment, never from the request. |
| Hosting | **Vercel** | Matches the framework; edge caching for property pages. |

### Deliberately not used

No ORM (raw SQL in migrations is clearer for RLS-heavy schemas and there is one
data layer, not many) · no state management library (server state lives on the
server) · no component library (a bought design system is the fastest route to
looking like a template) · no analytics SDK · no AI at runtime in v1.

---

## 2. The two-adapter data layer

The single most important architectural decision in the repository.

Every read and write goes through one interface — `LivdRepository` in
`src/server/data/repository.ts`. Two implementations satisfy it:

```
src/server/data/
├── repository.ts          ← the interface. Nothing else is imported by app code.
├── index.ts               ← selects an adapter from LIVD_DATA_BACKEND
├── local/                 ← file-backed JSON store under ./.data
└── supabase/              ← PostgreSQL through @supabase/supabase-js
```

**Why two.** A founder must be able to clone the repository and see the real
product working — every flow, end to end, writes included — without provisioning
a database. The local adapter makes that true. The Supabase adapter is the
production path, with complete migrations and RLS policies in `supabase/`.

**The rule that keeps this honest:** the interface is defined by what production
needs, never narrowed to what the local store finds easy. Where the two adapters
implement the same rule independently — the proximity decision most importantly —
they are held to identical constants by `tests/verification/parity.test.ts`.

A repository contract suite running both adapters against one set of assertions
is not written yet, and until it is, the interface is what keeps them aligned
rather than a test.

Authentication follows the identical pattern in `src/server/auth/` — a signed
cookie session for local development, Supabase Auth in production. The local
adapter refuses to start when `NODE_ENV=production`.

---

## 3. Rendering and caching

| Route | Strategy |
| --- | --- |
| `/` | Static, revalidated hourly |
| `/property/[slug]` | Server-rendered, `revalidate: 300`, tag-invalidated on review write |
| `/places` | Dynamic — discovery prefers the visitor's country; every list cached at the data layer |
| `/places/all` | Server-rendered, revalidated hourly |
| `/places/[country]` | Server-rendered, revalidated hourly |
| `/places/[country]/[locality]` | Server-rendered, revalidated hourly |
| `/places/[country]/[locality]/[neighbourhood]` | Server-rendered, revalidated hourly |
| `/search` | Dynamic — depends on query |
| `/api/suggest` | Route handler, 60s cache, no personal data |
| `/review/*`, `/account/*`, `/admin/*` | Dynamic, `no-store`, auth-gated |

Publishing a review calls `revalidateTag('property:<id>')`, so the property page
and its aggregates refresh immediately without a full rebuild.

Client JavaScript is confined to genuinely interactive surfaces: the search
combobox, the review wizard, filter and sort controls, the comparison table, save
buttons, dialogs. Everything else — including all scoring, aggregation and verdict
generation — is server-only.

---

## 4. Directory layout

```
src/
├── app/                    Routes (App Router)
│   ├── page.tsx            Landing
│   ├── how-it-works/       ·  trust/  ·  for-owners/  ·  legal/
│   ├── search/             Results
│   ├── property/[slug]/    Property profile + reviews + claim
│   ├── places/             Explore, then country / city / neighbourhood (SEO surface)
│   ├── review/             Contribution wizard
│   ├── shortlist/          Saved properties + comparison
│   ├── account/            Profile, my reviews
│   ├── admin/              Moderation, claims, verification, config
│   └── api/                Suggest, sitemap, health
├── components/
│   ├── ui/                 Primitives — Button, Field, Choice, Dialog, Toast…
│   ├── property/           Score dial, category bars, departure chart, timeline
│   ├── search/             Combobox, filters, nearby
│   ├── layout/             Header, footer, nav, skip link
│   └── brand/              Logotype and brand mark

   The review wizard's steps live beside the route that owns them, in
   `src/app/review/`, rather than in `components/`.
├── lib/
│   ├── intelligence/       scoring · verdict · departures · trends · checklist
│   ├── safety/             content linter · privacy redaction · rate limits
│   ├── format/             currency · date · address · number  (Intl-based)
│   ├── validation/         Zod schemas
│   └── utils/
├── server/
│   ├── auth/               Session, adapters, guards
│   ├── data/               Repository interface + adapters
│   ├── notify/             Transport · email shell · message catalogue · dispatcher
│   ├── safety/             Server-side bot verification
│   └── actions/            Server Actions (the only write path)
├── config/                 markets · categories · departure reasons · site
├── content/                copy.ts — every user-facing string
└── types/
```

### Localisation readiness

No user-facing string is written inline in a component. All copy resolves through
`src/content/copy.ts`, a nested object typed as `const`. Introducing a second
locale means adding a sibling object and a resolver — not touching components.

All numbers, currencies, dates and relative times go through `Intl` wrappers in
`src/lib/format/`. There is no hard-coded currency symbol, date format or
thousands separator anywhere in the codebase.

---

## 5. International data model

**Address.** A property carries `country_code`, `admin_area` (state / province /
county), `locality` (city / town), `neighbourhood`, `street_address`,
`postal_code` and an optional `building_name`. Every field except `country_code`
and `locality` is nullable, because address structure genuinely differs by
country. Rendering is driven by a per-country format template in
`src/config/markets.ts`, so a UK address prints as a UK address.

**Currency.** Stored per-value as `(amount_minor, currency_code)`. There is no
global currency setting and no default symbol.

**Property type.** A reference table — `apartment`, `flat`, `condo`, `house`,
`townhouse`, `duplex`, `studio`, `shared`, `room`, `bungalow`, `maisonette` — with
per-market display labels, so the same underlying type renders as "flat" in the
UK and "apartment" in the US.

**Phone.** E.164 only, no national assumptions, and never displayed publicly.

---

## 6. Scoring pipeline

`src/lib/intelligence/scoring.ts` — pure, dependency-free, and the most heavily
tested file in the repository.

Verification multiplies a review's weight: 1.0 unchecked, **1.3 location
verified**, 1.8 residency verified by a moderator, 0 disputed. The middle value
is a judgement and a deliberately modest one — presence at an address rules out
the reviewer who has never been to the building, which is real, and says nothing
about whether they held a tenancy there, which is what the 1.8 is for. Recency
is a separate, *derived* dimension: `src/lib/intelligence/recency.ts` buckets an
experience as current, recent, former or older from its age, so nobody verifies
once and stays a "current resident" for ever. Freshness is counts only and never
feeds the score.

```
reviews
  → per-review weight = recency(months) × verification × statusPenalty
  → per-category weighted mean
  → Bayesian shrinkage toward prior (k = 6 effective reviews)
  → category weights → overall 0–100
  → effective sample size → confidence band
```

Pure functions in, plain data out. No database access, no framework imports,
fully unit-testable. Aggregates are computed on read and cached with the page;
`property_stats` in Postgres holds a denormalised copy maintained by trigger for
list and search ordering.

---

## 7. Trust and safety implementation

| Control | Where |
| --- | --- |
| Content linting (contact details, named individuals, threats, slurs, allegations) | `src/lib/safety/content-linter.ts`, called by the submit action before persistence |
| Unit-number redaction | Same linter, plus a database column grant that excludes `unit_label` from public views |
| Duplicate prevention | Unique index on `(property_id, author_id, tenancy_key)` |
| Rate limiting | `src/lib/safety/rate-limit.ts` — sliding window keyed by user and salted origin hash, counted in Postgres by `livd_rate_limit_hit` so the limit is per person rather than per warm instance |
| Owner self-review block | Checked in the submit action against `property_claims` |
| Burst detection | `src/lib/safety/burst-detection.ts` holds the rules; `livd_detect_property_flags` is the same three tests in SQL, run hourly by pg_cron. Raises `property_flags` for a moderator at `/admin/flags`; never changes a review, a status or a score |
| Moderation queue | `review_reports` + `moderation_actions`, full audit trail, admin-only RLS |
| Residency verification | Resident uploads at `/account/reviews`; `src/lib/safety/verification-checks.ts` settles what a machine can; a moderator decides at `/admin/verification`. Evidence lives in a private bucket with no policy for any client role, and reaches a moderator through a five-minute signed URL |
| Property verification | A location check in the review wizard. The decision is made inside Postgres by `livd_verify_property_location` so a client can ask for a verdict but never assert one; `src/lib/geo/proximity.ts` is the same rule for the local adapter, held to it by `tests/verification/parity.test.ts`. No coordinate is stored anywhere |
| Review level integrity | `livd_derive_review_verification`, a BEFORE INSERT trigger, derives `verification_level` from the verification a review points at and refuses one belonging to another person or another property |
| Bot mitigation | `src/server/safety/captcha.ts`, called by the submit action before the schema is parsed. Whether a token is required is read from `TURNSTILE_SECRET_KEY` on the server, so a caller who never rendered the widget meets the same wall. A definite "no" fails the submission; an unreachable Cloudflare does not, for the same reason the rate limiter degrades rather than closing |
| Right of reply | An approved claimant may post one public response per review of their property. `owner_responses_insert` is the control; the check in the Server Action exists only to produce a better message than a policy refusal can. `scripts/security/owner-response-matrix.sql` runs the whole matrix against the live database and rolls back |
| Authorisation | `requireUser` / `requireRole` guards; RLS as the second, authoritative layer |

**Defence in depth is the rule.** Every write is checked in the Server Action
*and* constrained by RLS. Neither layer is trusted alone.

---

## 7a. Notifications

Livd sends transactional email and nothing else — no newsletter, no digest,
no marketing list. Three audiences, one dispatcher.

| Event | Who is told |
| --- | --- |
| A review is published, held, removed or restored | Its author |
| A property responds to a review | The reviewer |
| A review is published on a claimed property | The approved claimant |
| A claim is approved or refused | The claimant |
| A review is reported · a claim is submitted | Moderators and above |
| A high or critical case · an authority request | Trust & Safety and above |

**Nobody is told they were reported.** A report is not a decision — reporting
does nothing to a review on its own — so an email about one would tell an
author that an unnamed person has complained, give them nothing to do about
it, and invite exactly the retaliation the anonymity model exists to prevent.
They are told when something happens to their review.

**The address never reaches application memory by any other route.**
`profiles` has no email column and the admin directory returns a mask computed
in Postgres. Writing to somebody is a different act from looking them up, so it
has its own door rather than widening that one:
`livd_notification_recipient` and `livd_notification_staff` are
SECURITY DEFINER with EXECUTE revoked from every client role, and neither
writes an identity-access audit entry — filling the log that answers "which
moderator looked up whose identity" with events no human performed would make
it unreadable.

**One event, one email.** `notification_events.dedupe_key` is unique and the
claim is `insert … on conflict do nothing returning id`, so a retried action,
two concurrent callers and five writes of one status all resolve to one send.
The same table is the delivery log.

**Nothing here can break the thing it reports on.** Every path is wrapped and
returns void, and dispatch runs inside `after()` from `next/server` — after
the response, while the invocation is still alive.

**Logs carry the kind, the outcome and the recipient's domain.** Never the
address, never the user id, never the message.

Recipients choose what reaches them at `/account/notifications`. Two things
are not optional: a sign-in link, and a decision that removes something they
wrote or changes their account's standing.

---

## 8. Security posture

- Mutations are Server Actions only. No public write endpoints.
- Every input parsed with Zod at the server boundary; client validation is a
  convenience, never a control.
- RLS enabled on every table. Default deny.
- The service-role key is imported by exactly two server-only modules and is
  guarded by a `server-only` import that fails the build if it reaches a client
  bundle.
- Sessions: `httpOnly`, `secure`, `sameSite=lax`, signed.
- Strict CSP, HSTS, `X-Content-Type-Options`, `frame-ancestors 'none'` — set in
  `next.config.ts`.
- User-submitted text is rendered as text. No `dangerouslySetInnerHTML` anywhere.
- Verification evidence is unreadable by any client role.
- A position is an argument, never a row. `property_verifications` has no
  latitude, longitude, accuracy or distance column, so there is no location
  history to leak, subpoena or lose.

---

## 9. SEO

Server-rendered property pages with per-page metadata, canonical URLs, Open Graph
and Twitter cards; `Place` + `AggregateRating` JSON-LD emitted **only** where the
confidence band justifies it; three levels of indexable place page —
`/places/[country]`, `/places/[country]/[locality]` and
`/places/[country]/[locality]/[neighbourhood]` — plus the full index at
`/places/all`; generated `sitemap.xml` and `robots.txt` excluding all
authenticated routes.

`/places` itself is the discovery surface rather than an index, and its
canonical URL carries no scope: the country it leads with is resolved per
visitor from their account or a coarse edge header and is never in the URL, so
there is no near-duplicate of a country page to compete with. The navigation
labels it "Explore"; the route is unchanged because it is indexed, linked from
every property page and present in the sitemap.

No review author information — not even a pseudonym — appears in structured data.

---

## 10. Testing

| Suite | Covers |
| --- | --- |
| `tests/intelligence/` | Scoring, shrinkage, decay, confidence bands, departures, trends, verdict |
| `tests/safety/` | Content linter across evasion cases; rate limiter |
| `tests/format/` | Multi-market address, currency and date formatting |
| `tests/design/` | Every token pair the design puts together, read out of `globals.css` |
| `tests/auth/` | Redirect safety on the sign-in path |
| `tests/components/` | Month-and-year field behaviour |
| `tests/notify/` | The message catalogue's anonymity rule, subject length, plain-text twin, HTML escaping · the dispatcher's four guarantees: send-once, preferences, never breaking the action, no identity in a log line |
| `tests/verification/` | Proximity maths and its uncertainty budget · resident recency and freshness · TypeScript/SQL constant parity · what a public review does and does not carry · server-side enforcement against every spoofing path · the verification step's states |

Highest-risk-first: scoring correctness, safety pipeline, authorisation.

---

## 11. Accessibility

WCAG 2.2 AA is a build constraint, not a QA pass. Semantic landmarks, a skip
link, visible focus on every interactive element, `aria-live` for async results,
focus trapping and restoration in dialogs, form errors tied by
`aria-describedby`, 4.5:1 contrast across both themes, full keyboard operation of
the combobox and wizard, and `prefers-reduced-motion` honoured globally.
