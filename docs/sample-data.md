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
  candidate set (0054), fenced with `as materialized` (0055) — without the
  fence the planner pushed the final filter back down into a full scan and the
  candidates bought nothing. Measured over the finished dataset: 136 ms before,
  143 ms with the candidates alone, 14-44 ms with the fence.
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

As loaded in production, read back from the database. The generator
produces exactly these rows; regenerate this table when the geography
changes.

| Country | Regions | Cities | Neighbourhoods | Properties | Reviews |
| --- | ---: | ---: | ---: | ---: | ---: |
| Australia | 7 | 8 | 80 | 616 | 5,286 |
| Canada | 6 | 8 | 80 | 612 | 5,248 |
| France | 7 | 8 | 68 | 570 | 4,589 |
| Germany | 7 | 8 | 79 | 641 | 5,091 |
| India | 9 | 10 | 113 | 1,000 | 8,129 |
| Ireland | 4 | 4 | 30 | 256 | 2,086 |
| Netherlands | 5 | 6 | 45 | 406 | 3,351 |
| Nigeria | 17 | 17 | 171 | 998 | 8,218 |
| South Africa | 4 | 5 | 49 | 465 | 3,950 |
| United Arab Emirates | 3 | 3 | 32 | 310 | 2,687 |
| United Kingdom | 12 | 12 | 157 | 833 | 7,217 |
| United States | 14 | 18 | 202 | 1,509 | 12,917 |
| **Total** | **95** | **107** | **1106** | **8,216** | **68,769** |

By city:

| Country | Region | City | Neighbourhoods | Properties | Reviews |
| --- | --- | --- | ---: | ---: | ---: |
| Australia | NSW | Sydney | 22 | 171 | 1,576 |
| Australia | VIC | Melbourne | 18 | 160 | 1,344 |
| Australia | QLD | Brisbane | 11 | 90 | 784 |
| Australia | WA | Perth | 9 | 70 | 522 |
| Australia | SA | Adelaide | 6 | 50 | 476 |
| Australia | ACT | Canberra | 5 | 30 | 221 |
| Australia | QLD | Gold Coast | 5 | 25 | 207 |
| Australia | TAS | Hobart | 4 | 20 | 156 |
| Canada | ON | Toronto | 20 | 171 | 1,506 |
| Canada | BC | Vancouver | 13 | 121 | 1,132 |
| Canada | QC | Montreal | 13 | 110 | 979 |
| Canada | AB | Calgary | 9 | 60 | 509 |
| Canada | ON | Ottawa | 9 | 60 | 519 |
| Canada | AB | Edmonton | 6 | 40 | 265 |
| Canada | NS | Halifax | 5 | 25 | 184 |
| Canada | MB | Winnipeg | 5 | 25 | 154 |
| France | Île-de-France | Paris | 22 | 190 | 1,614 |
| France | Auvergne-Rhône-Alpes | Lyon | 10 | 90 | 637 |
| France | Provence-Alpes-Côte d'Azur | Marseille | 9 | 80 | 645 |
| France | Nouvelle-Aquitaine | Bordeaux | 6 | 50 | 383 |
| France | Occitanie | Toulouse | 6 | 50 | 523 |
| France | Hauts-de-France | Lille | 5 | 40 | 320 |
| France | Pays de la Loire | Nantes | 5 | 40 | 239 |
| France | Provence-Alpes-Côte d'Azur | Nice | 5 | 30 | 228 |
| Germany | Berlin | Berlin | 19 | 171 | 1,484 |
| Germany | Bavaria | Munich | 13 | 110 | 858 |
| Germany | Hamburg | Hamburg | 12 | 100 | 840 |
| Germany | North Rhine-Westphalia | Cologne | 9 | 70 | 543 |
| Germany | Hesse | Frankfurt | 9 | 70 | 553 |
| Germany | North Rhine-Westphalia | Düsseldorf | 6 | 40 | 258 |
| Germany | Saxony | Leipzig | 6 | 40 | 249 |
| Germany | Baden-Württemberg | Stuttgart | 5 | 40 | 306 |
| India | Maharashtra | Mumbai | 21 | 190 | 1,632 |
| India | Karnataka | Bengaluru | 17 | 170 | 1,367 |
| India | Delhi | Delhi | 16 | 160 | 1,279 |
| India | Tamil Nadu | Chennai | 12 | 100 | 840 |
| India | Telangana | Hyderabad | 12 | 100 | 789 |
| India | Maharashtra | Pune | 11 | 90 | 675 |
| India | West Bengal | Kolkata | 10 | 80 | 814 |
| India | Gujarat | Ahmedabad | 6 | 40 | 257 |
| India | Haryana | Gurugram | 4 | 40 | 265 |
| India | Uttar Pradesh | Noida | 4 | 30 | 211 |
| Ireland | County Dublin | Dublin | 16 | 151 | 1,438 |
| Ireland | County Cork | Cork | 6 | 50 | 344 |
| Ireland | County Galway | Galway | 4 | 30 | 164 |
| Ireland | County Limerick | Limerick | 4 | 25 | 140 |
| Netherlands | Noord-Holland | Amsterdam | 15 | 151 | 1,309 |
| Netherlands | Zuid-Holland | Rotterdam | 8 | 80 | 699 |
| Netherlands | Zuid-Holland | The Hague | 7 | 60 | 513 |
| Netherlands | Utrecht | Utrecht | 7 | 60 | 546 |
| Netherlands | Noord-Brabant | Eindhoven | 4 | 30 | 161 |
| Netherlands | Groningen | Groningen | 4 | 25 | 123 |
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
| South Africa | Western Cape | Cape Town | 16 | 150 | 1,443 |
| South Africa | Gauteng | Johannesburg | 15 | 150 | 1,372 |
| South Africa | KwaZulu-Natal | Durban | 6 | 70 | 490 |
| South Africa | Gauteng | Pretoria | 8 | 70 | 502 |
| South Africa | Eastern Cape | Gqeberha | 4 | 25 | 143 |
| United Arab Emirates | Dubai | Dubai | 18 | 170 | 1,562 |
| United Arab Emirates | Abu Dhabi | Abu Dhabi | 9 | 90 | 726 |
| United Arab Emirates | Sharjah | Sharjah | 5 | 50 | 399 |
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
| United States | NY | New York | 16 | 170 | 1,474 |
| United States | CA | Los Angeles | 19 | 160 | 1,465 |
| United States | IL | Chicago | 18 | 141 | 1,205 |
| United States | NY | Brooklyn | 14 | 121 | 1,105 |
| United States | TX | Houston | 12 | 90 | 767 |
| United States | CA | San Francisco | 14 | 90 | 769 |
| United States | TX | Austin | 12 | 81 | 693 |
| United States | WA | Seattle | 12 | 81 | 572 |
| United States | MA | Boston | 12 | 80 | 678 |
| United States | DC | Washington | 12 | 80 | 720 |
| United States | GA | Atlanta | 10 | 75 | 625 |
| United States | PA | Philadelphia | 10 | 70 | 723 |
| United States | TX | Dallas | 8 | 60 | 522 |
| United States | FL | Miami | 8 | 60 | 445 |
| United States | CO | Denver | 8 | 50 | 477 |
| United States | AZ | Phoenix | 6 | 40 | 282 |
| United States | MN | Minneapolis | 6 | 30 | 214 |
| United States | OR | Portland | 5 | 30 | 181 |
