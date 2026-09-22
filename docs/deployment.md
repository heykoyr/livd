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
NEXT_PUBLIC_SITE_URL=https://livd.site # the origin this deployment is served from
```

Two optional groups turn on features rather than enabling the application.
Livd runs correctly with neither, and says so rather than pretending:

```
RESEND_API_KEY=...                     # resend.com > API Keys. Production only
LIVD_EMAIL_FROM=                       # defaults to Livd <notifications@livd.site>
LIVD_EMAIL_REPLY_TO=                   # defaults to support@livd.site

NEXT_PUBLIC_TURNSTILE_SITE_KEY=...     # dash.cloudflare.com > Turnstile
TURNSTILE_SECRET_KEY=...
```

**Email.** Without `RESEND_API_KEY` the transport logs the subject and the
recipient's domain to the server console and reports success, so every flow
works end to end and nothing fails because a notification could not be sent.
That is also the control that stops development and preview builds mailing
real people: the key is set on Production only.

`LIVD_EMAIL_FROM` must be on a domain verified with the provider or every send
is refused with a 403 naming the domain. It defaults to
`Livd <notifications@livd.site>`. The full architecture — addresses, SPF, DKIM,
DMARC, and why the sending domain is the apex — is in [`email.md`](email.md).

**Bot protection.** Both halves or neither. The server decides whether a
token is required from `TURNSTILE_SECRET_KEY` alone — never from anything the
browser sends — so with the secret set, a submission arriving without a valid
token is refused whether it came from the form or from a script calling the
Server Action directly. `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is read at build
time and also decides whether `challenges.cloudflare.com` appears in the
Content-Security-Policy, so changing it needs a redeploy rather than an
environment edit — the same trap as `NEXT_PUBLIC_GOOGLE_SIGN_IN`.

**On the two keys.** The anon key is safe in a browser — Row Level Security is
what protects the data, not the secrecy of that key. `SUPABASE_SERVICE_ROLE_KEY`
bypasses every policy: it is the one real secret, is imported by exactly two
server-only modules, is guarded by a `server-only` import that fails the build if
it reaches a client bundle, and is never prefixed `NEXT_PUBLIC_`.

Everything a visitor does works without the service-role key, because every
public read and every review submission goes through RLS as the `anon` or
`authenticated` role. Moderation does not: `/admin` needs the key to act on the
queue.

**On `NEXT_PUBLIC_SITE_URL`.** Production is `https://livd.site`. It drives
canonical URLs, Open Graph tags, the sitemap — and the `emailRedirectTo` on
every magic link, which is the one that bites. If it disagrees with Supabase's
own Site URL, Supabase does not error: it silently substitutes its own, and
people sign in on the wrong origin. Both have to agree; see
[`domain.md`](domain.md) for the order they have to change in, and
[`supabase/templates/README.md`](../supabase/templates/README.md) for the
dashboard half.

A production build resolves `https://livd.site` on its own when the variable is
missing, so a lost environment variable cannot put a deployment hostname into a
canonical tag. Unset on a Vercel *preview*, the app falls back to `VERCEL_URL`,
so previews stay self-consistent without anyone configuring them.

```bash
npm run domain:check
```

Asks DNS, Vercel, Supabase and Resend from outside and prints what is actually
true. Run it after any change to the domain, the auth URLs or the mail records.

---

## 3. The database

Forty-eight migrations in [`supabase/migrations/`](../supabase/migrations), applied
in order. They are the canonical DDL; [`database-schema.md`](database-schema.md)
explains the reasoning.

Counted against the live project rather than estimated: 41 tables, every one
with Row Level Security enabled and denying by default · 63 policies · 100
`livd_*` functions · triggers maintaining `property_stats` ·
`pg_cron` running burst detection hourly.

Apply them through the Supabase dashboard's SQL editor, the Supabase CLI, or any
Postgres client. There is no ORM and no migration runner to install — raw SQL is
clearer for an RLS-heavy schema, and there is one data layer rather than many.

### Seeding the sample data

```bash
npm run seed:supabase -- --dry                    # the plan; nothing is written
npm run seed:supabase                             # everything
npm run seed:supabase -- --countries=NG           # one market
npm run seed:supabase -- --cities=GB/London       # one city
npm run seed:supabase -- --purge                  # remove it, if nothing real depends on it
```

Reuses the same generator as the local store, so the two cannot describe
different properties. The dataset — real cities and neighbourhoods, invented
properties, sample reviews on the existing review model — is described in
[sample-data.md](sample-data.md).

**Insert-only.** Every write is `ON CONFLICT DO NOTHING` on a deterministic id,
so a row that already exists, seeded or real, is never modified. Re-running is
safe, and growing a city inserts only what is new. A property whose rows are
all already present is skipped without sending anything.

Everything it writes is marked `is_demo`, which is what makes the **Sample data**
badge appear, marks those pages `noindex`, and keeps them out of the sitemap and
the admin platform figures.

It needs the service-role key: sample rows have no authenticated author, so
every RLS insert policy correctly refuses them. It runs no application code and
so sends no email.

`--purge` refuses if any real account has saved, location-checked, reviewed,
claimed or reported sample data, because deleting a sample property cascades
into those rows. In production that is already the case, so the way to hide
sample data there is `LIVD_SHOW_DEMO_DATA=false`, not a purge.

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

Livd is deployed on Vercel at **<https://livd.site>** and rebuilds on every
push to `main`. The domain, DNS, `www` behaviour and SSL are documented
separately in [`domain.md`](domain.md).

Environment variables to set on the project:

| Variable | Environments | |
| --- | --- | --- |
| `LIVD_DATA_BACKEND` | Production, Preview | `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All three | Public by design — RLS is the protection |
| `SUPABASE_SERVICE_ROLE_KEY` | Production | Secret. Moderation does not work without it |
| `NEXT_PUBLIC_SITE_URL` | Production | `https://livd.site`. Previews fall back to `VERCEL_URL` |
| `RESEND_API_KEY` | Production **only** | Secret. Unset elsewhere is what stops previews mailing real users |
| `LIVD_SESSION_SECRET` | Production, Preview | |
| `LIVD_SHOW_DEMO_DATA` | Production, Preview | `true` only while seeded data is the content |
| `LIVD_GEOCODER` | Production, Preview | **Required for proximity search and location verification to work at all.** See below |
| `LIVD_GEOCODER_CONTACT` | Production, Preview | Required if `LIVD_GEOCODER` includes `nominatim` |

### Without a geocoder, two features are silently off

This is not a nice-to-have, and it has already cost a real failure worth
writing down.

`createProperty` geocodes the address when a geocoder is configured, and stores
`coordinates: null` when one is not. A property with no coordinates:

- can never appear in "Show properties near me", because
  `livd_properties_near` requires a non-null position — correctly, since a null
  coordinate cannot be measured against anything; and
- never offers the location-verification step in the review wizard, because
  there is nothing to check the resident's position against.

Both failures are invisible. Nothing errors, nothing is logged, and the
property looks completely normal on its own page.

What that produced: the first two properties real contributors added were both
stored without coordinates, and a resident standing inside one of them — one
they had reviewed themselves — was told there were no Livd properties nearby.
The proximity code was correct throughout; the deployment simply had no
geocoder.

Two things now make it visible rather than silent:

- the admin overview shows a count of properties with no location recorded, and
  names this remedy;
- the nearby control distinguishes "nothing is near you" from "Livd holds
  properties here it cannot place", and says which.

**The cheapest correct configuration needs no API key:**

```
LIVD_GEOCODER=nominatim
LIVD_GEOCODER_CONTACT=you@example.com
```

Nominatim is free and asks only for an identifying contact in the `User-Agent`,
which its usage policy requires — the provider is skipped rather than used in
breach of it if the contact is missing. Its coverage is uneven, and
deliberately so in the code: it resolves European addresses to buildings and
frequently returns only a road for Lagos, which the precision gate then refuses
rather than accepting a wrong coordinate. For markets where that matters, chain
a commercial provider in front of it:

```
LIVD_GEOCODER=google,nominatim
GOOGLE_MAPS_API_KEY=...
```

Setting this only helps properties added afterwards. For the ones already
stored without a position:

```
npm run geocode:backfill            # reports, writes nothing
npm run geocode:backfill -- --write
```

It never overwrites an existing coordinate, never lowers the precision bar, and
never touches seeded data.

Adding a secret:

```bash
npm run vercel -- env add SUPABASE_SERVICE_ROLE_KEY production --type secret
```

### Authentication

Supabase Auth, no passwords stored, two ways in: Google, and an email carrying a
link and a code. Both work in production.

**Email sign-in** is described end to end in
[`supabase/templates/README.md`](../supabase/templates/README.md) §0. In short:
the link goes to `/auth/confirm` on `livd.site` with Supabase's token hash;
opening it spends nothing, and one tap redeems it with `verifyOtp`, in whatever
browser the email opened in. Until 21 September 2026 the email used Supabase's
default link, which only completed in the browser that had asked for it — so
on an iPhone that opens links in Chrome, a link requested in Safari always
failed. The dashboard settings it depends on are recorded in that file.

**Google** uses PKCE through `/auth/callback`, which is correct there: one tab
does the whole round trip, so the verifier cookie is always present.

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

**The email is Livd's.** Custom SMTP through Resend (17 September 2026) is what
made the templates editable and the sender `Livd <notifications@livd.site>`;
the template itself is
[`supabase/templates/magic-link.html`](../supabase/templates/magic-link.html),
applied to both *Magic Link* and *Confirm signup*.

### Moving to a custom domain

One value changes: `NEXT_PUBLIC_SITE_URL`. Canonical links, Open Graph URLs, the
sitemap and the magic-link redirect all resolve through
[`SITE.url`](../src/config/site.ts) and follow it. The Supabase dashboard's own
Site URL has to be updated to match, or sign-in emails will redirect to the old
origin.
