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
needs, never narrowed to what the local store finds easy. Both adapters are held
to the same tests (`tests/data/repository.contract.test.ts`).

Authentication follows the identical pattern in `src/server/auth/` — a signed
cookie session for local development, Supabase Auth in production. The local
adapter refuses to start when `NODE_ENV=production`.

---

## 3. Rendering and caching

| Route | Strategy |
| --- | --- |
| `/` | Static, revalidated hourly |
| `/property/[slug]` | Server-rendered, `revalidate: 300`, tag-invalidated on review write |
| `/places/[country]/[region]/[locality]` | Server-rendered, revalidated hourly |
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
│   ├── (marketing)/        Landing, how-it-works, trust, legal
│   ├── search/             Results
│   ├── property/[slug]/    Property profile + reviews + claim
│   ├── places/             Location index pages (SEO surface)
│   ├── review/             Contribution wizard
│   ├── shortlist/          Saved properties + comparison
│   ├── account/            Profile, my reviews
│   ├── admin/              Moderation, claims, verification, config
│   └── api/                Suggest, sitemap, health
├── components/
│   ├── ui/                 Primitives — Button, Field, Dialog, Sheet, Toast…
│   ├── property/           Score dial, category bars, departure chart, timeline
│   ├── review/             Wizard steps, review card, filters
│   ├── search/             Combobox, result card, filters
│   └── layout/             Header, footer, nav, skip link
├── lib/
│   ├── intelligence/       scoring · verdict · departures · trends · checklist
│   ├── safety/             content linter · privacy redaction · rate limits
│   ├── format/             currency · date · address · number  (Intl-based)
│   ├── validation/         Zod schemas
│   └── utils/
├── server/
│   ├── auth/               Session, adapters, guards
│   ├── data/               Repository interface + adapters
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
| Burst detection | Scheduled aggregate over recent reviews per property; flags, never auto-deletes |
| Moderation queue | `review_reports` + `moderation_actions`, full audit trail, admin-only RLS |
| Authorisation | `requireUser` / `requireRole` guards; RLS as the second, authoritative layer |

**Defence in depth is the rule.** Every write is checked in the Server Action
*and* constrained by RLS. Neither layer is trusted alone.

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

---

## 9. SEO

Server-rendered property pages with per-page metadata, canonical URLs, Open Graph
and Twitter cards; `Place` + `AggregateRating` JSON-LD emitted **only** where the
confidence band justifies it; location index pages at
`/places/[country]/[region]/[locality]`; generated `sitemap.xml` and `robots.txt`
excluding all authenticated routes.

No review author information — not even a pseudonym — appears in structured data.

---

## 10. Testing

| Suite | Covers |
| --- | --- |
| `tests/intelligence/` | Scoring, shrinkage, decay, confidence bands, departures, trends, verdict |
| `tests/safety/` | Content linter across evasion cases; rate limiter |
| `tests/format/` | Multi-market address, currency and date formatting |
| `tests/data/` | Repository contract, run against the local adapter |
| `tests/actions/` | Submit, report, save — authorisation and validation paths |
| `tests/a11y/` | axe-core against rendered primitives and key screens |
| `tests/components/` | Wizard behaviour, search combobox keyboard interaction |

Highest-risk-first: scoring correctness, safety pipeline, authorisation.

---

## 11. Accessibility

WCAG 2.2 AA is a build constraint, not a QA pass. Semantic landmarks, a skip
link, visible focus on every interactive element, `aria-live` for async results,
focus trapping and restoration in dialogs, form errors tied by
`aria-describedby`, 4.5:1 contrast across both themes, full keyboard operation of
the combobox and wizard, and `prefers-reduced-motion` honoured globally.
