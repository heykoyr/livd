# Livd — Deployment

Everything needed to run Livd against PostgreSQL rather than the local file
store: environment, the production database, seeding, geocoding and hosting.

The application runs with none of this configured — see **Run it locally** in
the [README](../README.md). This document is for the production path.

---

## 1. The two backends

`LIVD_DATA_BACKEND` selects the adapter behind
[`LivdRepository`](../src/server/data/repository.ts).

| Value | Adapter | Notes |
| --- | --- | --- |
| `local` | File-backed JSON under `./.data` | Default. No external service. Refuses to start when `NODE_ENV=production`. |
| `supabase` | PostgreSQL through `@supabase/supabase-js` | Requires the migrations in `supabase/migrations/` to have been applied. |

Unset, Livd chooses `supabase` when both Supabase values are present and `local`
otherwise, so a fresh clone works and a configured deployment does the right
thing without a third setting to forget.

Do **not** set `LIVD_ALLOW_LOCAL_IN_PROD`. The local file store cannot work on a
serverless filesystem, and the guard that refuses it is deliberate.

---

## 2. Environment

Copy [`.env.example`](../.env.example) to `.env.local` and fill it in. That file
carries the full reasoning for each value; this is the summary.

```
LIVD_DATA_BACKEND=supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...      # Settings > API keys > anon
SUPABASE_SERVICE_ROLE_KEY=...          # Settings > API keys > service_role
LIVD_SESSION_SECRET=...                # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
NEXT_PUBLIC_SITE_URL=https://...       # the origin this deployment is actually served from
```

**On the two keys.** The anon key is safe in a browser — Row Level Security is
what protects the data, not the secrecy of that key. `SUPABASE_SERVICE_ROLE_KEY`
bypasses every policy: it is the one real secret, is imported by exactly two
server-only modules, is guarded by a `server-only` import that fails the build if
it reaches a client bundle, and is never prefixed `NEXT_PUBLIC_`.

Everything a visitor does works without the service-role key, because every
public read and every review submission goes through RLS as the `anon` or
`authenticated` role. Moderation does not: `/admin` needs the key to act on the
queue.

**On `NEXT_PUBLIC_SITE_URL`.** In production this must be the origin the site is
actually served from. It drives canonical URLs, Open Graph tags, the sitemap —
and the `emailRedirectTo` on every magic link, which is the one that bites. If
it is wrong or unset, Supabase discards the redirect Livd asks for and falls back
to the Site URL in its own dashboard. Both have to agree; see
[`supabase/templates/README.md`](../supabase/templates/README.md).

Unset on a Vercel preview, the app falls back to `VERCEL_URL`, so previews are
self-consistent without anyone configuring them.

---

## 3. The database

Eighteen migrations in [`supabase/migrations/`](../supabase/migrations), applied
in order. They are the canonical DDL; [`database-schema.md`](database-schema.md)
explains the reasoning.

27 tables, every one with Row Level Security enabled and denying by default ·
51 policies · 33 database functions · triggers maintaining `property_stats` ·
`pg_cron` running burst detection hourly.

Apply them through the Supabase dashboard's SQL editor, the Supabase CLI, or any
Postgres client. There is no ORM and no migration runner to install — raw SQL is
clearer for an RLS-heavy schema, and there is one data layer rather than many.

### Seeding the demonstration data

```bash
npm run seed:supabase -- --dry     # report what it would write
npm run seed:supabase              # apply
npm run seed:supabase -- --purge   # remove it again
```

Reuses the same generator as the local store, so the two cannot describe
different properties. Idempotent — ids are derived deterministically, so
re-running updates rather than duplicates.

Everything it writes is marked `is_demo`, which is what makes the **Sample data**
badge appear, marks those pages `noindex`, and keeps them out of the sitemap.

It needs the service-role key: demo rows have no authenticated author, so every
RLS insert policy correctly refuses them.

The seeded set is 16 properties, 222 reviews, 2,033 category ratings, 212
departure reasons and 1,313 tags.

`LIVD_SHOW_DEMO_DATA` controls whether seeded data is visible at all. It has to
be turned off the moment real reviews exist, or the two will sit side by side.

---

## 4. Geocoding

A property needs a coordinate before a resident can location-verify it.
Geocoding runs when a property is created.

```
LIVD_GEOCODER=google,nominatim
GOOGLE_MAPS_API_KEY=...                  # console.cloud.google.com, enable "Geocoding API"
LIVD_GEOCODER_CONTACT=you@example.com    # required by Nominatim's usage policy
```

`LIVD_GEOCODER` is a list tried in order. The two named providers fail
differently — Google on quota, billing and outage; Nominatim on coverage — so
chaining them means a lapsed card degrades coverage in the Gulf rather than
removing geocoding everywhere. `mapbox` is also supported
(`MAPBOX_ACCESS_TOKEN`) and its free tier needs no card, which makes it the
quickest way to improve on the free option.

### Coverage is the reason a paid provider is worth it, and it is not uniform

Measured against real addresses, not estimated:

| | Berlin · London · Austin | Lagos · Abuja | Cape Town | Dubai · Nairobi |
| --- | --- | --- | --- | --- |
| OpenStreetMap | building | road only — refused | road only — refused | no match |
| Google | building | building | building | building |

Admiralty Heights in Lekki, 10 Gana Street in Maitama, 32 Long Street in Cape
Town, Marina Gate in Dubai Marina and Britam Tower in Upper Hill all resolve to
buildings through Google, and none of them resolve through OpenStreetMap.

### Anything less precise than a building is refused

Whatever the provider. Nominatim answers "8 Admiralty Way, Lagos" with the road —
a feature spanning 1,716 metres — and a point along it can sit most of a
kilometre from the property. Storing that means offering a verification step a
real resident cannot pass, which is worse than offering no step at all. Refusing
is the better failure.

### Backfilling properties that predate the geocoder

```bash
npm run geocode:backfill              # dry run, writes nothing
npm run geocode:backfill -- --write   # apply
```

It never overwrites an existing coordinate, never lowers the precision bar, and
never touches demonstration data. It needs `SUPABASE_SERVICE_ROLE_KEY`.

Google and Mapbox are covered by fixture tests in their real response shapes but
have not been exercised against their live APIs, which needs paid keys.

---

## 5. Hosting

Livd is deployed on Vercel and rebuilds on every push to `main`.

Environment variables to set on the project:

| Variable | Environments | |
| --- | --- | --- |
| `LIVD_DATA_BACKEND` | Production, Preview | `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All three | Public by design — RLS is the protection |
| `SUPABASE_SERVICE_ROLE_KEY` | Production | Secret. Moderation does not work without it |
| `NEXT_PUBLIC_SITE_URL` | Production | Previews fall back to `VERCEL_URL` |
| `LIVD_SESSION_SECRET` | Production, Preview | |
| `LIVD_SHOW_DEMO_DATA` | Production, Preview | `true` only while seeded data is the content |

Adding a secret:

```bash
npm run vercel -- env add SUPABASE_SERVICE_ROLE_KEY production --type secret
```

### Authentication

Supabase Auth, no passwords stored, two ways in: Google, and a link sent by
email.

**Google is the one that works today.** Email delivery is not the problem — the
emails arrive. The problem is that a Supabase sign-in link may be used once, and
Gmail follows every link it delivers to scan it about fifteen seconds after it
lands. The scanner spends the link before the person opens the message, so the
click that follows fails. Every account created before Google sign-in existed
shows the same signature: email confirmed, session never created, a consistent
fourteen-to-nineteen second gap between the link being sent and being used.
Nothing is emailed in the Google flow, so there is nothing to intercept.

Both halves have to exist before the button appears, and Livd cannot see either
one, so `NEXT_PUBLIC_GOOGLE_SIGN_IN` gates it and defaults to off. A button that
leads to an error page is worse than no button — it is the control a new visitor
is most likely to press first.

Setting it up, once:

1. Google Cloud console → **Google Auth Platform → Clients → Create client**.
   Application type **Web application**. The only authorised redirect URI is the
   Supabase callback, `https://<project-ref>.supabase.co/auth/v1/callback` — not
   the Livd origin. Livd is where Supabase sends the browser *afterwards*, which
   is a different setting.
2. Copy the client ID and secret into Supabase → **Authentication → Sign In /
   Providers → Google**, and enable it. Copy and paste them; a value poked into
   those fields by script does not register with the form, which saves an empty
   secret behind a client ID that looks correct and fails later as
   `invalid_client`.
3. Add the Livd origin to Supabase → **Authentication → URL Configuration →
   Redirect URLs** as `https://<origin>/**`. The action sends an absolute
   `redirectTo`, and Supabase discards any value not on that list.
4. Set `NEXT_PUBLIC_GOOGLE_SIGN_IN=true` and redeploy. It is read at build time,
   so setting it without a rebuild changes nothing.

Note what the consent screen says: "to continue to
`<project-ref>.supabase.co`", not "Livd". Google names the domain that owns the
OAuth client, and that is Supabase's until Livd has a custom auth domain.

**The email link is the fallback, and it is still incomplete.** Custom SMTP is
the gap: Supabase's built-in sender disables the Subject and Body fields
outright, so the branded template in
[`supabase/templates/magic-link.html`](../supabase/templates/magic-link.html)
cannot be applied and the sender still reads "Supabase Auth". It is also rate
limited to a few emails an hour and is not something to launch on. One setting
gates all three, and it needs a domain with SPF and DKIM. Sending a typed code
rather than a link would also close the scanner hole, and editing that email
needs the same setting.

### Moving to a custom domain

One value changes: `NEXT_PUBLIC_SITE_URL`. Canonical links, Open Graph URLs, the
sitemap and the magic-link redirect all resolve through
[`SITE.url`](../src/config/site.ts) and follow it. The Supabase dashboard's own
Site URL has to be updated to match, or sign-in emails will redirect to the old
origin.
