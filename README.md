# Livd

**Know what it's really like to live there.**

A global property intelligence platform built on real resident experiences.
Livd collects what people who actually lived at a property say about it —
including why they left — and turns it into something a prospective renter can
make a decision with.

---

## Run it

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

No database, no accounts, no configuration. The app ships with a file-backed
local store seeded with sixteen properties across eight countries, and it works
end to end: search, the property pages, the review flow, moderation, all of it.

Everything seeded is labelled **Sample data** wherever it appears, and none of
it can reach a search index.

### Signing in

The local adapter has no email step. Enter any address on `/sign-in` and you are
signed in immediately. The first account created becomes an admin, so `/admin`
is reachable straight away.

This adapter refuses to run in production.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Test suite |
| `npm run typecheck` | TypeScript, no emit |
| `npm run audit:a11y` | axe-core against a running server |
| `npm run verify` | Typecheck, tests and build together |
| `npm run reset` | Clears `.data` and `.next`, reseeding on next run |

> **`npm run reset` clears both on purpose.** Property aggregates are cached
> under `.next` and survive a dev-server restart, so deleting `.data` alone
> leaves the previous seed's numbers rendering with no sign they are stale.

---

## Where things are

```
docs/                     Start here — spec, architecture, design system, schema
supabase/migrations/      The production database: schema, functions, RLS
src/
├── app/                  Routes
├── components/           UI primitives and product components
├── config/               Markets, categories, departure reasons, tags
├── content/copy.ts       Every user-facing string
├── lib/
│   ├── intelligence/     Scoring, verdict, departures, timeline
│   ├── safety/           Content linter, rate limiting
│   ├── format/           Intl wrappers — address, money, dates
│   └── validation/       Zod schemas
└── server/
    ├── auth/             Sessions and guards
    ├── data/             Repository interface + two adapters
    └── actions/          Server Actions — the only write path
tests/                    116 tests, weighted to the highest-risk code
```

### The three files worth reading first

- **`src/lib/intelligence/scoring.ts`** — the Livd Score. Every constant is
  named and explained, and the reasoning behind each is in the comments.
- **`src/lib/safety/content-linter.ts`** — how Livd keeps reviews about
  properties rather than about people.
- **`src/server/data/repository.ts`** — the one interface every read and write
  goes through.

---

## The two data adapters

Every read and write goes through `LivdRepository`. Two implementations satisfy
it:

- **`local`** — a JSON file under `.data`. No external service. The default.
- **`supabase`** — PostgreSQL with Row Level Security. The production path.

The interface is shaped by what production needs, never narrowed to what the
local store finds easy, and both adapters are held to the same behaviour. That
is what lets you clone this repository and see the real product working —
writes included — without provisioning anything.

### The production database

A Supabase project is provisioned and all sixteen migrations are applied:

| | |
| --- | --- |
| Project | `Livd` (Koyr org, `eu-west-2`) |
| URL | `https://tehkyjihyyhxxrqlvmck.supabase.co` |
| Tables with RLS | 25, with 48 policies |

To point the app at it, set in `.env.local`:

```
LIVD_DATA_BACKEND=supabase
NEXT_PUBLIC_SUPABASE_URL=https://tehkyjihyyhxxrqlvmck.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...        # Settings > API keys > anon
SUPABASE_SERVICE_ROLE_KEY=...            # Settings > API keys > service_role
LIVD_SESSION_SECRET=...                  # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Optionally, to give newly added properties a coordinate so residents can
location-verify them:

```
LIVD_GEOCODER=nominatim
LIVD_GEOCODER_CONTACT=you@example.com    # required by Nominatim's usage policy
```

Both are optional and off by default. Without them, a property added by a
contributor has no coordinate and simply does not offer the verification step —
everything else about it works normally.

The anon key is safe in a browser — Row Level Security is what protects the
data, not the secrecy of that key. `SUPABASE_SERVICE_ROLE_KEY` bypasses every
policy: it is the one real secret, is read only by server-only modules, is
never prefixed `NEXT_PUBLIC_`, and moderation will not work without it.

The database is seeded: 16 properties, 222 reviews, 2,033 category ratings,
212 departure reasons and 1,313 tags, all marked `is_demo`.

### Seeding the demonstration data

```bash
npm run seed:supabase -- --dry   # report what it would write
npm run seed:supabase            # apply
npm run seed:supabase -- --purge # remove it again
```

Reuses the same generator as the local store, so the two cannot describe
different properties. Everything it writes is marked `is_demo`, which is what
makes the "Sample data" badge appear, marks those pages `noindex`, and keeps
them out of the sitemap. Idempotent — ids are derived deterministically, so
re-running updates rather than duplicates.

It needs the service-role key: demo rows have no authenticated author, so every
RLS insert policy correctly refuses them.

### Deploying

Livd is deployed on Vercel and rebuilds on every push to `main`.

| | |
| --- | --- |
| Project | `koyrstudio/livd` |
| Production | <https://livd-koyrstudio.vercel.app> |
| Repository | <https://github.com/heykoyr/livd> |

Environment variables set on the project:

| Variable | Environments | |
| --- | --- | --- |
| `LIVD_DATA_BACKEND` | Production, Preview | `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All three | Public by design — RLS is the protection |
| `NEXT_PUBLIC_SITE_URL` | Production | Previews fall back to `VERCEL_URL` |
| `LIVD_SESSION_SECRET` | Production, Preview | |
| `LIVD_SHOW_DEMO_DATA` | Production, Preview | `true` while the seeded data is the content |

`SUPABASE_SERVICE_ROLE_KEY` is **not** set, on Vercel or locally. Everything a
visitor does works without it, because every public read and every review
submission goes through Row Level Security as the anon or authenticated role.
Moderation does not: `/admin` needs the key to act on the queue. To add it:

```bash
# Supabase dashboard > Project Settings > API keys > service_role
npm run vercel -- env add SUPABASE_SERVICE_ROLE_KEY production --type secret
```

Do **not** set `LIVD_ALLOW_LOCAL_IN_PROD` — the local file store cannot work on
a serverless filesystem, and the guard that refuses it is deliberate.

---

## What makes this product what it is

**A score is never shown without its basis.** Below a threshold of evidence, no
score is published at all and the page says what it does not know. "Why
residents leave" stays hidden until four former residents have answered,
because one person's reason rendered as "100%" is both meaningless and
potentially identifying.

**Reviews are about properties, not people.** Contact details, unit numbers and
named individuals are refused before publication, with a specific instruction
about what to change. The subject of a review is a building and the experience
of living in it.

**Verification is a signal, not a gate.** A resident can confirm they are at a
property before writing, and the review carries "Location verified" — which is
the honest claim, because being at a building is evidence of presence and not
of a tenancy. Livd never says it knows you live there. A review published
without verification is still published, still counted and still permanent;
verification changes how much weight it carries, not whether it exists. The
position itself is used for one comparison and never stored, so there is no
location history in the database to leak.

**Recency is part of the answer.** A five-star review from someone who left in
2019 and one from someone who was in the lobby last week are different claims,
and the property page now says which is which. The buckets are derived on read
rather than stored, so nobody verifies once and remains a "current resident"
for ever.

**Owners can reply. They cannot remove.** There is no column in the schema and
no policy in the database that would let a property owner alter a review's
visibility — not a rule that a persistent request could change.

**Moderation is on the record.** A review is never deleted, only restatused,
and every decision is written to a log no role can edit.

**Global from the first commit.** Address structure, currency, property-type
vocabulary and which review categories apply are all configuration. A Lagos
property is asked about water supply and never about central heating; a London
flat, the reverse. Neither is a special case in the code.

---

## Verified

- Tests weighted toward scoring, the safety linter, rate limiting, burst
  detection, the colour palette and the international layer.
- Zero axe-core violations across 13 pages in a production build.
- Verification enforcement exercised against the live database as an
  `authenticated` client, not asserted from the policy text: a client cannot
  insert its own verified row, cannot assert `verification_level` on a review,
  cannot use a verification belonging to another account or another property,
  and an approved property manager sees zero verification rows and zero
  reviewer profiles.
- The served HTML of a property page checked, signed out, for coordinates,
  accuracy, distance, verification ids, verification timestamps, author ids,
  emails, IP and device data. None present.
- Contrast checked in a real browser, both themes, and asserted per token pair
  by `tests/design/contrast.test.ts`. The one violation axe still reports is a
  disabled pagination control, which WCAG 1.4.3 exempts as an inactive
  component and which is `aria-hidden` besides.
- Every public route returns 200, every authenticated route redirects, and the
  sitemap contains no seeded data.

> An earlier version of this list claimed zero contrast failures "measured
> against real computed styles". That was wrong. `npm run audit:a11y` runs axe
> through jsdom, which computes no layout and resolves no custom properties, so
> it cannot evaluate contrast at all — a fact its own source comment records.
> Run properly in a browser it found thirty-five failures in light mode and
> nineteen in dark. They are fixed, and the palette is now covered by a test
> that runs on every commit.

---

## Not built yet

Maps — deliberately. A pin on a residential building is a liability before it is
a feature, and the privacy design has to come first. Also out of the MVP:
messaging between users, mobile apps, payments, and any AI-generated prose.

`docs/roadmap.md` has the rest.
