# Sample data

Livd ships with a sample dataset so that a supported city is explorable before
residents have written about it: real cities and neighbourhoods, invented
properties, and sample reviews written on the existing review model.

**Real geography, fictional properties, sample experiences.** Every country,
region, city and neighbourhood is a real place with a representative
coordinate. No property is a real building, and no review came from a person.

## What it is made of

| Level | Source |
| --- | --- |
| Country | Livd's own markets — `MARKETS` in `src/config/markets.ts`. Nothing here adds one. |
| Region, city, neighbourhood | `src/server/data/seed/geography/<country>.ts` — real names, a representative point per neighbourhood, a weight and a rent factor. |
| Property | Generated. An invented building name in the market's own naming style, **no street address and no postcode**, a coordinate within a few hundred metres of its neighbourhood's point, rounded to 3dp as every coordinate is. |
| Review | Generated on the existing model — current/former residency, the existing categories, tags and departure reasons, `unverified` or `verified_resident`. Never `location_verified`: that level records someone standing at a real building. |
| Author | The 120 sample accounts the original seed created, on the reserved `demo.livd.invalid` domain. No new accounts, and no name, email or detail of any real person. |

Why no street address: a real street with an invented house number is an
address that belongs to somebody, and a sample review against it would make a
real building appear to have Livd reviews. A sample property is placed by its
neighbourhood and never at a door.

The original sixteen sample properties (`generateLegacySeed` in
`src/server/data/local/seed.ts`) are kept exactly as they were. They are in
production, and real accounts have saved one and location-checked another.

## How seed data is identified

The existing mechanism, unchanged — nothing new is shown to residents:

- `properties.is_demo` and `reviews.is_demo` are `true` on every seeded row.
- Sample accounts use `@demo.livd.invalid` (RFC 2606: can never receive mail),
  with `livd_demo: true` in their metadata.

What that flag already did, and still does: the **Sample data** badge on cards,
headers and reviews; `noindex` on sample property pages; exclusion from the
sitemap; everything hidden when `LIVD_SHOW_DEMO_DATA=false`.

What 0052 added, because the dataset is now large enough for it to matter:

- **City, neighbourhood and country pages made only of sample properties are
  `noindex`**, and are left out of the sitemap — the rule sample property pages
  already followed.
- **The admin dashboard's platform figures exclude sample data**, and say so.
- **A real property can never collide with a sample one.** The address unique
  index is split by `is_demo`, and `findDuplicateProperty` ignores sample rows,
  so a resident adding their own building is never refused, or redirected to
  fabricated data, because a sample property shares its name.

## Safety

- **Insert-only.** `npm run seed:supabase` writes with `ON CONFLICT DO NOTHING`
  on deterministic ids. It never modifies a row that exists, seeded or real.
- **No email.** It writes rows directly with the service role and runs no
  application code; every notification Livd sends is sent by a Server Action.
- **No Trust & Safety noise.** Every seeded review is dated on or before
  `SAMPLE_AS_OF` (1 September 2026). The review-burst and account-signal
  detectors look at the last 48 hours, and the loader refuses to run if that
  date is less than three days ago. Seeded reviews are `published`, so they
  create no queue, report, flag, case or verification record.
- **No destructive default.** `--purge` refuses while any real account has
  saved, location-checked, reviewed, claimed or reported sample data.

`tests/seed/` holds all of this: every body passes the content linter real
reviews go through, dates and tenancies satisfy the table's constraints, the
loader only ever inserts, and the original sixteen are byte-identical.

## Growing it

A property's identity is `country/city/neighbourhood/index`, and everything
about it — name, type, coordinate, reviews — is derived from that key alone.

- **"Expand London from 220 to 300"** — raise `properties` on London in
  `geography/gb.ts` and run `npm run seed:supabase -- --cities=GB/London`. The
  existing 220 are unchanged; the new ones are inserted.
- **"Add 500 more properties to Nigeria"** — raise city counts in
  `geography/ng.ts` (or add a city) and run
  `npm run seed:supabase -- --countries=NG`.
- **A new neighbourhood** — append it to the end of its city's list.
  Neighbourhood position is part of how building names stay unique within a
  city; inserting one in the middle renames later properties in the generator
  (the database keeps its rows, so the two would disagree).
- **A new market** — only one Livd already supports. Add a flavour to
  `flavour.ts` and a geography file, and list it in `geography/index.ts`.

Lowering a count removes nothing: the loader never deletes.

The local development store uses a slice of the same dataset — the original
sixteen plus three properties per city (`LOCAL_PER_CITY`) — so every page works
on a laptop without a store the size of a database.

## What loading it turned up

Four defects that a sixteen-property dataset could not show, each fixed where
it was rather than worked around in the seed:

- **Place pages counted in JavaScript.** Explore, the country and city pages,
  the directory and the sitemap selected one row per property and aggregated in
  the application. PostgREST truncates a response at 1,000 rows, so past that
  size the counts would have been quietly short. Now aggregated in Postgres
  (0052).
- **`ts_rank > 0` was not a match test.** It returns a tiny positive number for
  a row matching none of a multi-word query's words, so every two-word search
  matched the whole table: "Port Harcourt" returned all 1,842 seeded
  properties. A full-text match now means all the words (0054).
- **Search read every property on every keystroke.** Now an index-backed
  candidate set (0054).
- **Sample accounts broke Auth's user listing.** The original SQL seed left four
  token columns NULL in `auth.users`, where Auth always writes `''` and reads
  them as strings. Any admin user listing for the whole project failed with
  "Database error finding users" (0053).

Two more were found and fixed in the application rather than the database: a
resident adding a building could be matched to a sample property as a duplicate
(`findDuplicateProperty` now ignores sample rows), and city pages loaded every
review in the city to render one screen of cards.

**One known divergence.** Five review sentences that assumed a tenancy had
ended ("while I lived there") were reworded after Nigeria and the United
Kingdom had been seeded. About 400 rows there keep the earlier wording, 174 of
them on reviews by current residents. The loader never rewrites a row that
exists, and rewriting them would have written several hundred
evidence-preservation snapshots about sample data. Everything seeded since uses
the corrected wording.

## Coverage

Generated from `generateSeed({ scale: 'full' })`, the original sixteen included.
Regenerate when the geography changes.

| Country | Regions | Cities | Neighbourhoods | Properties | Reviews |
| --- | ---: | ---: | ---: | ---: | ---: |
| Australia | 1 | 1 | 1 | 1 | 15 |
| Canada | 2 | 2 | 2 | 2 | 27 |
| Germany | 1 | 1 | 1 | 1 | 13 |
| Ireland | 1 | 1 | 1 | 1 | 2 |
| Netherlands | 1 | 1 | 1 | 1 | 12 |
| Nigeria | 17 | 17 | 171 | 998 | 8,218 |
| United Kingdom | 12 | 12 | 157 | 833 | 7,217 |
| United States | 4 | 4 | 4 | 4 | 49 |
| **Total** | **39** | **39** | **338** | **1,841** | **15,553** |

By city:

| Country | Region | City | Neighbourhoods | Properties | Reviews |
| --- | --- | --- | ---: | ---: | ---: |
| Australia | NSW | Sydney | 1 | 1 | 15 |
| Canada | ON | Toronto | 1 | 1 | 18 |
| Canada | BC | Vancouver | 1 | 1 | 9 |
| Germany | Berlin | Berlin | 1 | 1 | 13 |
| Ireland | County Dublin | Dublin | 1 | 1 | 2 |
| Netherlands | Noord-Holland | Amsterdam | 1 | 1 | 12 |
| Nigeria | Lagos State | Lagos | 32 | 222 | 1,922 |
| Nigeria | FCT | Abuja | 23 | 161 | 1,512 |
| Nigeria | Rivers State | Port Harcourt | 13 | 90 | 658 |
| Nigeria | Oyo State | Ibadan | 13 | 80 | 604 |
| Nigeria | Edo State | Benin City | 10 | 60 | 489 |
| Nigeria | Enugu State | Enugu | 12 | 60 | 525 |
| Nigeria | Kano State | Kano | 10 | 50 | 421 |
| Nigeria | Kaduna State | Kaduna | 9 | 45 | 351 |
| Nigeria | Kwara State | Ilorin | 8 | 35 | 360 |
| Nigeria | Ogun State | Abeokuta | 8 | 30 | 168 |
| Nigeria | Cross River State | Calabar | 5 | 25 | 170 |
| Nigeria | Plateau State | Jos | 5 | 25 | 143 |
| Nigeria | Imo State | Owerri | 5 | 25 | 240 |
| Nigeria | Akwa Ibom State | Uyo | 4 | 25 | 173 |
| Nigeria | Delta State | Warri | 5 | 25 | 159 |
| Nigeria | Ondo State | Akure | 4 | 20 | 184 |
| Nigeria | Anambra State | Onitsha | 5 | 20 | 139 |
| United Kingdom | Greater London | London | 43 | 221 | 2,105 |
| United Kingdom | Greater Manchester | Manchester | 18 | 121 | 1,127 |
| United Kingdom | West Midlands | Birmingham | 15 | 100 | 886 |
| United Kingdom | City of Edinburgh | Edinburgh | 11 | 60 | 474 |
| United Kingdom | Glasgow City | Glasgow | 11 | 60 | 476 |
| United Kingdom | West Yorkshire | Leeds | 11 | 60 | 604 |
| United Kingdom | Bristol | Bristol | 11 | 51 | 440 |
| United Kingdom | Merseyside | Liverpool | 11 | 50 | 424 |
| United Kingdom | Cardiff | Cardiff | 7 | 30 | 168 |
| United Kingdom | Tyne and Wear | Newcastle upon Tyne | 6 | 30 | 214 |
| United Kingdom | Nottinghamshire | Nottingham | 7 | 25 | 123 |
| United Kingdom | South Yorkshire | Sheffield | 6 | 25 | 176 |
| United States | TX | Austin | 1 | 1 | 19 |
| United States | NY | Brooklyn | 1 | 1 | 23 |
| United States | IL | Chicago | 1 | 1 | 7 |
| United States | WA | Seattle | 1 | 1 | 0 |
