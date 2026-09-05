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

### Moving to Supabase

1. Create a Supabase project.
2. Apply `supabase/migrations/*.sql` in order.
3. Copy `.env.example` to `.env.local` and fill in the three Supabase values.
4. Set `LIVD_DATA_BACKEND=supabase` and `LIVD_SHOW_DEMO_DATA=false`.

`SUPABASE_SERVICE_ROLE_KEY` bypasses every security policy. It is read by
server-only modules, never prefixed `NEXT_PUBLIC_`, and never reaches a browser.

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

- 116 tests, weighted toward scoring, the safety linter and the international
  layer.
- Zero axe-core violations across 13 pages in a production build.
- Zero contrast failures across six pages in both light and dark themes,
  measured against real computed styles.
- Every public route returns 200, every authenticated route redirects, and the
  sitemap contains no seeded data.

---

## Not built yet

Maps — deliberately. A pin on a residential building is a liability before it is
a feature, and the privacy design has to come first. Also out of the MVP:
messaging between users, mobile apps, payments, and any AI-generated prose.

`docs/roadmap.md` has the rest.
