# Livd — Database Schema

PostgreSQL 15+. Canonical DDL lives in `supabase/migrations/`; this document
explains the reasoning. Every table has RLS enabled and denies by default.

---

## Conventions

`uuid` primary keys (`gen_random_uuid()`) · `timestamptz` throughout, `created_at`
and `updated_at` on every mutable table · soft deletion via status enums, never
`DELETE`, so moderation stays auditable · money as `(amount_minor bigint,
currency_code char(3))` — never a float, never a global currency · months as
`date` pinned to day 1, so no exact tenancy dates are ever stored.

---

## Reference tables

Configuration, not code. Adding a market or a category is a data change.

**`countries`** — `code` (ISO-3166-1 alpha-2, PK), `name`, `default_currency`,
`address_format` (token template such as `{street}\n{locality} {postal_code}`),
`region_label` ("State" / "Province" / "County"), `locality_label`, `is_active`.

**`currencies`** — `code` (ISO-4217, PK), `name`, `minor_unit`, `symbol`.

**`property_type_defs`** — `key` (PK), `sort_order`, `is_active`.

**`property_type_labels`** — `(type_key, country_code)` → `label`. Renders
"flat" in GB and "apartment" in US from one underlying type.

**`review_category_defs`** — `key` (PK), `label`, `description`, `is_core`,
`weight` (numeric, contribution to the overall score), `applies_to_countries`
(`text[]`, null = global), `prompt` (the question shown to a reviewer),
`sort_order`.

**`departure_reason_defs`** — `key` (PK), `label`, `is_sensitive`, `sort_order`.
`is_sensitive` marks reasons (harassment, discrimination, safety) that are
counted in aggregates but never rendered as a quotable headline.

**`review_tag_defs`** — `key`, `polarity` (`positive` | `problem`), `label`,
`category_key` (FK, nullable) — the structured chips behind "what was good" and
"what was difficult".

---

## Identity

**`profiles`** — extends `auth.users`. `id` (PK, FK → `auth.users`),
`display_handle` (generated, never shown on reviews), `country_code`,
`preferred_locale`, `role` (`resident` | `owner` | `moderator` | `admin`),
`status` (`active` | `restricted` | `suspended`), `reputation` (int),
`created_at`.

No name, phone or address column exists on `profiles`. There is nothing to leak
because nothing is collected.

---

## Property

**`properties`**

| Column | Notes |
| --- | --- |
| `id` | PK |
| `slug` | unique, URL-safe, generated from locality + street |
| `building_name` | nullable |
| `street_address` | nullable — street and number, never a unit |
| `neighbourhood` | nullable |
| `locality` | **not null** — the one universally present component |
| `admin_area` | nullable — state / province / county |
| `postal_code` | nullable |
| `country_code` | **not null**, FK → `countries` |
| `latitude` / `longitude` | nullable, **rounded to 3dp (~110m)** before storage |
| `property_type` | FK → `property_type_defs` |
| `unit_count` | nullable |
| `year_built` | nullable |
| `status` | `active` \| `pending_review` \| `merged` \| `removed` |
| `merged_into` | self-FK, so duplicates resolve without breaking links |
| `is_demo` | boolean — seeded sample data, labelled wherever it appears |
| `created_by` | FK → `profiles` |
| `search_vector` | generated `tsvector`, GIN-indexed |

Indexes: unique `slug` · GIN on `search_vector` · GIN `pg_trgm` on
`building_name` and `street_address` for typo tolerance · composite
`(country_code, locality, neighbourhood)` for location pages · partial index on
`status = 'active'`.

Duplicate prevention: a unique index on
`(country_code, locality, lower(coalesce(street_address,'')), lower(coalesce(building_name,'')))`
where `status = 'active'`.

**`property_aliases`** — `property_id`, `alias`, `source`. Former building names
and colloquial names, folded into search.

**`property_stats`** — denormalised rollup maintained by trigger, so search and
list ordering never recompute scores: `review_count`, `verified_review_count`,
`overall_score`, `confidence`, `recommend_rate`, `category_scores` (jsonb),
`departure_breakdown` (jsonb), `trend_direction`, `last_review_at`.

---

## Reviews

**`reviews`**

| Column | Notes |
| --- | --- |
| `id` | PK |
| `property_id` | FK, indexed |
| `author_id` | FK → `profiles` |
| `residency_status` | `current` \| `former` |
| `moved_in_month` | `date`, day 1 |
| `moved_out_month` | `date`, day 1, null when current |
| `tenure_months` | generated, checked ≥ 1 |
| `overall_rating` | smallint 1–5 |
| `body` | text, nullable, ≤ 4000 |
| `would_recommend` | boolean |
| `rent_amount_minor` / `rent_currency` | both nullable, both-or-neither constraint |
| `rent_period` | `month` \| `year` |
| `verification_level` | `unverified` \| `verified_resident` \| `disputed` |
| `status` | `published` \| `pending_moderation` \| `held` \| `removed` |
| `safety_flags` | `text[]` from the content linter |
| `tenancy_key` | generated `author + property + move-in year` |
| `is_demo` | boolean |

Constraints: `moved_out_month >= moved_in_month` · a former resident must supply
`moved_out_month` · `unit_label` is **not** on this table and is never joined
into a public view · unique index on `(property_id, author_id, tenancy_key)`
prevents duplicate reviews for the same tenancy.

**`review_category_ratings`** — `(review_id, category_key)` PK, `rating` 1–5.

**`review_departure_reasons`** — `(review_id, reason_key)` PK, `is_primary`.
A partial unique index enforces at most one primary reason per review.

**`review_tags`** — `(review_id, tag_key)` PK.

**`review_helpful_votes`** — `(review_id, voter_id)` PK. Ranking signal only;
never alters a score.

---

## Ownership and response

**`property_claims`** — `property_id`, `claimant_id`, `role_claimed`
(`owner` | `manager` | `agent`), `evidence_ref` (points at
`verification_records`, never the evidence itself), `status`
(`pending` | `approved` | `rejected` | `revoked`), `reviewed_by`, `decided_at`.
Partial unique index: one approved claim per property.

**`owner_responses`** — `review_id`, `property_id`, `responder_id`, `body`,
`status`, `is_resolution_notice`. Unique on `review_id` — one response per
review. **No mechanism anywhere in the schema allows an owner to alter a
review's status.**

---

## Trust and safety

**`review_reports`** — `review_id`, `reporter_id`, `reason` (`inappropriate` |
`false_information` | `privacy` | `spam` | `harassment` | `not_a_resident` |
`other`), `detail`, `status`, `resolution`. Unique on `(review_id, reporter_id)`.

**`moderation_actions`** — append-only audit log: `actor_id`, `subject_type`,
`subject_id`, `action`, `reason`, `previous_status`, `new_status`,
`metadata` jsonb. No `UPDATE` or `DELETE` grant to any role.

**`verification_records`** — `subject_type`, `subject_id`, `method`,
`evidence_url` (private storage bucket), `outcome`, `reviewed_by`, `notes`,
`expires_at`. **RLS grants `select` to `service_role` only.** No authenticated
user, including the record's own subject, can read this table through the API.

Since 0012 a record also carries `submitted_by`, `evidence_sha256`,
`evidence_mime`, `evidence_bytes`, `checks` and `decided_at`. The hash is what
makes "has this exact document already been used by four different residents"
answerable without anyone reading it. `checks` holds the automated findings
verbatim, so the moderation queue shows a person the same thing the code saw.
A partial unique index allows one pending request per review.

The document itself lives in the private `verification-evidence` bucket, keyed
by a UUID that encodes nothing. `storage.objects` carries RLS and no policy is
written for that bucket, so anon and authenticated are denied outright — the
only reader is server code holding the service role, after a moderator guard,
through a signed URL that lasts five minutes. `evidence_ref` is that key and
never a URL: a URL in a row is a URL in a backup. The adapter does not map it
onto the domain object at all, so no route, component or log can render it by
accident.

**`property_flags`** — `property_id`, `kind` (`review_burst`, `rating_anomaly`,
`new_account_concentration`), `severity` 1–3, the window examined, `observed`
(the arithmetic that raised it), `detail`, and a moderator's `status`,
`reviewed_by`, `reviewed_at`.

Written only by `livd_detect_property_flags`, which pg_cron runs hourly. A
partial unique index on `(property_id, kind) where status = 'open'` keeps one
open flag of each kind per property, so a re-run refreshes the numbers instead
of filling the queue with the same finding every hour; a decided flag is not
raised again for seven days.

RLS: moderators select and update, and no other role sees them at all — telling
a review author that their property has been flagged tells whoever is running a
campaign exactly when to stop. No insert or delete policy exists for anyone: the
rows come from the detector, and a flag that was raised stays on the record.

**`rate_limit_events`** — `bucket_key`, `actor_hash` (salted SHA-256, never a raw
IP), `occurred_at`. Indexed on `(bucket_key, actor_hash, occurred_at)`.

Written only through `livd_rate_limit_hit(bucket, actor_hash, window_seconds)`,
which prunes, records, counts and reports when a slot next frees up in one
round trip, under an advisory lock keyed on the actor so concurrent requests
cannot each count before the others are visible. The window slides: a fixed one
would let someone spend a full allowance at 11:59 and another at 12:00.

Service role only. Both this function and `livd_prune_rate_limit_events()` have
EXECUTE revoked from `anon` and `authenticated` — a browser-callable version
would let anyone holding the public anon key write unbounded rows under actor
hashes of their own invention. `livd_prune_rate_limit_events()` runs nightly on
pg_cron and clears anything older than two days; the longest configured window
is 24 hours, so nothing older can affect a decision.

---

## Personalisation

**`saved_properties`** — `(user_id, property_id)` PK, `note`, `created_at`.
Private to the owner by RLS.

**`search_events`** — `query_hash`, `country_code`, `locality`, `result_count`,
`occurred_at`. Deliberately no `user_id` and no raw query text, so search history
cannot be reconstructed against a person.

**`notifications`** — `user_id`, `kind`, `payload` jsonb, `read_at`.

---

## Functions and triggers

`livd_refresh_property_stats(property_id)` — recomputes the rollup using the same
weighting the application applies, fired by an `AFTER INSERT/UPDATE/DELETE`
trigger on `reviews` and `review_category_ratings`.

`livd_property_search(query text, country text, limit int)` — combined
`tsvector` rank and `pg_trgm` similarity over properties and aliases, so
"Adminralty Way" still finds "Admiralty Way".

`livd_slugify(text)` — deterministic, unicode-aware slug generation.

`set_updated_at()` — standard `BEFORE UPDATE` trigger.

---

## Row Level Security — the shape of it

| Table | Public read | Write |
| --- | --- | --- |
| Reference tables | yes | service role only |
| `properties` | `status = 'active'` | insert: authenticated; update: moderators, or an approved claimant for factual columns only |
| `property_stats` | yes | trigger only |
| `reviews` | `status = 'published'` | insert: authenticated, author must be self; update: author within 24h **or** moderator; delete: nobody |
| `review_reports` | no | insert: authenticated; read: reporter (own) + moderators |
| `moderation_actions` | no | insert: moderators; update/delete: nobody |
| `verification_records` | no | service role only, read and write |
| `saved_properties` | no | owner only |
| `owner_responses` | `status = 'published'` | approved claimant of the property only |

The author's 24-hour edit window exists so a typo can be fixed; after that the
record is immutable, because a review that can be rewritten later is not a
historical record.
