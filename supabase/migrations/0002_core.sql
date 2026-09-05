-- ===========================================================================
-- Livd — 0002 · Properties, reviews and trust
--
-- The privacy rules are enforced here as structure, not convention:
--
--   * `reviews` has no unit column. There is nowhere to store a unit number
--     against a review, so no query can ever leak one.
--   * `verification_records` is a separate table with its own access rules,
--     so evidence of residency is never reachable from a review.
--   * `search_events` has no user_id, so search history cannot be reconstructed
--     against a person even by someone with full database access.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Properties
-- ---------------------------------------------------------------------------

create table properties (
  id             uuid primary key default gen_random_uuid(),
  slug           text        not null unique,

  building_name  text,
  street_address text,
  neighbourhood  text,
  locality       text        not null,          -- the one universally present component
  admin_area     text,
  postal_code    text,
  country_code   char(2)     not null references countries(code),

  -- Rounded to 3dp (~110m) on write. Livd never stores a unit-precise location.
  latitude       numeric(6,3),
  longitude      numeric(6,3),

  property_type  text        not null references property_type_defs(key),
  unit_count     int check (unit_count is null or unit_count > 0),
  year_built     smallint check (year_built is null or year_built between 1400 and 2100),

  status         property_status not null default 'active',
  merged_into    uuid references properties(id),

  is_demo        boolean     not null default false,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- A property must be identifiable by something more than its city.
  constraint properties_identifiable
    check (building_name is not null or street_address is not null),

  constraint properties_merge_target
    check (merged_into is null or status = 'merged')
);

create trigger properties_set_updated_at
  before update on properties
  for each row execute function set_updated_at();

-- Full-text search over every address component plus the property type.
alter table properties add column search_vector tsvector
  generated always as (
    to_tsvector('simple',
      coalesce(building_name, '') || ' ' ||
      coalesce(street_address, '') || ' ' ||
      coalesce(neighbourhood, '') || ' ' ||
      locality || ' ' ||
      coalesce(admin_area, '') || ' ' ||
      coalesce(postal_code, '')
    )
  ) stored;

create index properties_search_idx      on properties using gin (search_vector);
create index properties_trgm_street_idx on properties using gin (street_address gin_trgm_ops);
create index properties_trgm_name_idx   on properties using gin (building_name gin_trgm_ops);
create index properties_locality_idx    on properties (country_code, locality, neighbourhood);
create index properties_active_idx      on properties (status) where status = 'active';

-- Duplicate prevention. Two active properties cannot describe the same address.
create unique index properties_address_unique on properties (
  country_code,
  lower(locality),
  lower(coalesce(street_address, '')),
  lower(coalesce(building_name, ''))
) where status = 'active';

-- Former and colloquial names, folded into search.
create table property_aliases (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  alias       text not null,
  source      text not null default 'resident',
  created_at  timestamptz not null default now(),
  unique (property_id, alias)
);

create index property_aliases_trgm_idx on property_aliases using gin (alias gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------

create table reviews (
  id                uuid primary key default gen_random_uuid(),
  property_id       uuid not null references properties(id) on delete cascade,
  author_id         uuid not null references profiles(id) on delete cascade,

  residency_status  residency_status not null,
  -- Pinned to the first of the month. Livd never stores an exact tenancy date.
  moved_in_month    date not null,
  moved_out_month   date,
  tenure_months     int  not null check (tenure_months >= 1),

  overall_rating    smallint not null check (overall_rating between 1 and 5),
  body              text check (body is null or char_length(body) <= 4000),
  would_recommend   boolean  not null,

  rent_amount_minor bigint check (rent_amount_minor is null or rent_amount_minor >= 0),
  rent_currency     char(3) references currencies(code),
  rent_period       rent_period,

  noticed_management_change boolean,

  verification_level verification_level not null default 'unverified',
  status             review_status      not null default 'published',
  safety_flags       text[]             not null default '{}',

  helpful_count      int         not null default 0 check (helpful_count >= 0),
  is_demo            boolean     not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint reviews_month_pinned
    check (extract(day from moved_in_month) = 1
       and (moved_out_month is null or extract(day from moved_out_month) = 1)),

  constraint reviews_chronology
    check (moved_out_month is null or moved_out_month >= moved_in_month),

  -- A former resident must say when they left; a current one must not.
  constraint reviews_residency_dates
    check (
      (residency_status = 'former'  and moved_out_month is not null) or
      (residency_status = 'current' and moved_out_month is null)
    ),

  -- Money is a pair or it is nothing.
  constraint reviews_rent_complete
    check (
      (rent_amount_minor is null and rent_currency is null and rent_period is null) or
      (rent_amount_minor is not null and rent_currency is not null and rent_period is not null)
    )
);

create trigger reviews_set_updated_at
  before update on reviews
  for each row execute function set_updated_at();

create index reviews_property_idx  on reviews (property_id, status);
create index reviews_author_idx    on reviews (author_id);
create index reviews_status_idx    on reviews (status) where status <> 'published';
create index reviews_published_idx on reviews (property_id, created_at desc) where status = 'published';

-- One review per person, per property, per tenancy.
--
-- Keyed on the move-in year rather than the exact month, so someone correcting
-- "March" to "April" cannot manufacture a second review of the same tenancy.
create unique index reviews_one_per_tenancy on reviews (
  property_id,
  author_id,
  extract(year from moved_in_month)
) where status <> 'removed';

create table review_category_ratings (
  review_id    uuid not null references reviews(id) on delete cascade,
  category_key text not null references review_category_defs(key),
  rating       smallint not null check (rating between 1 and 5),
  primary key (review_id, category_key)
);

create index review_category_ratings_category_idx on review_category_ratings (category_key);

create table review_departure_reasons (
  review_id  uuid not null references reviews(id) on delete cascade,
  reason_key text not null references departure_reason_defs(key),
  is_primary boolean not null default false,
  primary key (review_id, reason_key)
);

-- At most one primary reason per review, so shares always sum to 1.
create unique index review_one_primary_reason
  on review_departure_reasons (review_id) where is_primary;

create table review_tags (
  review_id uuid not null references reviews(id) on delete cascade,
  tag_key   text not null references review_tag_defs(key),
  primary key (review_id, tag_key)
);

create table review_helpful_votes (
  review_id uuid not null references reviews(id) on delete cascade,
  voter_id  uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (review_id, voter_id)
);

-- ---------------------------------------------------------------------------
-- Rollup
--
-- Denormalised so search and list ordering never recompute scores. Maintained
-- by trigger; see 0003.
-- ---------------------------------------------------------------------------

create table property_stats (
  property_id           uuid primary key references properties(id) on delete cascade,
  review_count          int  not null default 0,
  verified_review_count int  not null default 0,
  overall_score         int  check (overall_score is null or overall_score between 0 and 100),
  confidence            text not null default 'insufficient',
  effective_sample_size numeric(8,2) not null default 0,
  recommend_rate        numeric(4,3),
  current_resident_count int not null default 0,
  former_resident_count  int not null default 0,
  last_review_at        timestamptz,
  updated_at            timestamptz not null default now()
);

create index property_stats_score_idx   on property_stats (overall_score desc nulls last);
create index property_stats_reviews_idx on property_stats (review_count desc);
create index property_stats_recent_idx  on property_stats (last_review_at desc nulls last);

-- ---------------------------------------------------------------------------
-- Ownership
-- ---------------------------------------------------------------------------

create table property_claims (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references properties(id) on delete cascade,
  claimant_id   uuid not null references profiles(id) on delete cascade,
  role_claimed  claim_role  not null,
  organisation  text,
  contact_email text        not null,
  status        claim_status not null default 'pending',
  reviewed_by   uuid references profiles(id),
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);

create unique index property_claims_one_approved
  on property_claims (property_id) where status = 'approved';

create index property_claims_status_idx   on property_claims (status);
create index property_claims_claimant_idx on property_claims (claimant_id, status);

-- A right of reply. Note that there is no column here — and no grant anywhere —
-- that would let a responder change a review's status.
create table owner_responses (
  id                   uuid primary key default gen_random_uuid(),
  review_id            uuid not null references reviews(id) on delete cascade unique,
  property_id          uuid not null references properties(id) on delete cascade,
  responder_id         uuid not null references profiles(id) on delete cascade,
  body                 text not null check (char_length(body) between 20 and 2000),
  is_resolution_notice boolean not null default false,
  status               review_status not null default 'published',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger owner_responses_set_updated_at
  before update on owner_responses
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Trust and safety
-- ---------------------------------------------------------------------------

create table review_reports (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references reviews(id) on delete cascade,
  reporter_id uuid not null references profiles(id) on delete cascade,
  reason      report_reason not null,
  detail      text check (detail is null or char_length(detail) <= 1000),
  status      report_status not null default 'open',
  resolution  text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  unique (review_id, reporter_id)
);

create index review_reports_status_idx on review_reports (status, created_at desc);

-- Append-only audit log. No update or delete grant exists for any role.
create table moderation_actions (
  id              uuid primary key default gen_random_uuid(),
  actor_id        uuid not null references profiles(id),
  subject_type    text not null check (subject_type in ('review','property','user','claim','owner_response')),
  subject_id      uuid not null,
  action          text not null,
  reason          text,
  previous_status text,
  new_status      text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index moderation_actions_subject_idx on moderation_actions (subject_id, created_at desc);
create index moderation_actions_actor_idx   on moderation_actions (actor_id, created_at desc);

-- Verification evidence.
--
-- Read access is granted to no client role at all — not even to the subject of
-- the record. It is reachable only through the service role, from server code
-- that has already passed a moderator guard.
create table verification_records (
  id           uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('review','claim','user')),
  subject_id   uuid not null,
  method       text not null,
  evidence_ref text,                 -- object key in a private bucket, never a URL
  outcome      text not null default 'pending',
  reviewed_by  uuid references profiles(id),
  notes        text,
  expires_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index verification_records_subject_idx on verification_records (subject_type, subject_id);

-- Rate limiting. `actor_hash` is a salted digest — never a raw IP address.
create table rate_limit_events (
  id          bigserial primary key,
  bucket_key  text not null,
  actor_hash  text not null,
  occurred_at timestamptz not null default now()
);

create index rate_limit_events_lookup_idx
  on rate_limit_events (bucket_key, actor_hash, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Personalisation
-- ---------------------------------------------------------------------------

create table saved_properties (
  user_id     uuid not null references profiles(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  note        text check (note is null or char_length(note) <= 500),
  created_at  timestamptz not null default now(),
  primary key (user_id, property_id)
);

create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  kind       text not null,
  payload    jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on notifications (user_id, created_at desc);

-- Search analytics.
--
-- No user_id and no raw query text — only a hash and the coarse location. The
-- product needs to know that people search for places it has no data on; it
-- does not need to know who searched for what.
create table search_events (
  id           bigserial primary key,
  query_hash   text not null,
  country_code char(2) references countries(code),
  locality     text,
  result_count int not null default 0,
  occurred_at  timestamptz not null default now()
);

create index search_events_time_idx on search_events (occurred_at desc);
