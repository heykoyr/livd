-- ===========================================================================
-- Livd — 0014 · Property verification
--
-- The product problem: a review is only worth reading if the person who wrote
-- it has some real connection to the building. The obvious solution — demand
-- that reviewers be standing inside the flat at the moment they press publish —
-- is both trivially spoofable and hostile to the people it is meant to serve.
--
-- So this is not that. It establishes one signal, honestly described:
--
--     this account was at this property, at this time.
--
-- Which is evidence of presence and nothing more. Being near a building does
-- not prove you live in it, the product never says it does, and the weight the
-- level carries in the score is set accordingly.
--
-- Three structural decisions, each of which is the reason this file looks the
-- way it does:
--
-- 1. THE DECISION IS MADE HERE, NOT IN THE APPLICATION.
--    `livd_verify_property_location` takes a position as *arguments*, does the
--    arithmetic, and writes the verdict. The caller receives a verdict, never
--    the chance to assert one. This is also what makes the feature work on a
--    deployment with no service-role key: the function is SECURITY DEFINER and
--    granted to `authenticated`, so the browser's session can reach it while
--    the table beneath it stays unwritable by every client role.
--
-- 2. NO COORDINATE IS EVER STORED.
--    `property_verifications` has no latitude, no longitude, no accuracy, no
--    distance, no IP, no user agent. Look at the table: the columns are the
--    whole argument. Coordinates exist for the duration of one function call.
--    There is no location history here because there is nowhere to put one.
--
-- 3. THE REVIEW CANNOT LIE ABOUT ITS OWN LEVEL.
--    `verification_level` is derived by a BEFORE INSERT trigger from the
--    verification the review points at, and that verification must belong to
--    the same person and the same property. A client that sends
--    `verification_level: 'verified_resident'` gets `unverified`; a client that
--    verifies property A and submits a review of property B is refused
--    outright.
--
--    That third point closes a hole that predates this feature. `reviews`
--    accepted an INSERT with any `verification_level` the client chose:
--    `reviews_insert_self` constrained the author and the ownership check but
--    not that column, and `livd_guard_review_update` only ever ran on UPDATE.
--    Anyone holding the public anon key could publish a review at 1.8× weight
--    with a "Verified" badge on it. The trigger below is what stops that.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

/*
 * How a verification was established.
 *
 * `location` is the only method implemented. The others are declared now
 * because the architecture has to be able to hold them — a lease, a utility
 * account in the resident's name, a landlord confirming a tenancy, an existing
 * verified resident vouching for a neighbour — and each would produce this same
 * record with a different level attached. Declaring them costs nothing and
 * means adding one later is a code change rather than a migration against a
 * live enum.
 */
create type property_verification_method as enum (
  'location',
  'lease',
  'utility',
  'landlord',
  'invitation'
);

create type property_verification_status as enum ('verified', 'failed');

-- ---------------------------------------------------------------------------
-- The audit trail
--
-- Failures are recorded as well as successes. Not to build a profile of
-- anyone — there is nothing here to build one from — but because "this account
-- failed forty checks against nine properties last night" is the shape of
-- abuse, and it is unanswerable if only successes are kept.
--
-- `failure_reason` is deliberately coarse. It carries no distance, so a caller
-- cannot binary-search a property's true position by reading refusals, and a
-- moderator reading the trail learns what went wrong without learning where
-- anybody was.
-- ---------------------------------------------------------------------------

create table property_verifications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles(id)   on delete cascade,
  property_id    uuid not null references properties(id) on delete cascade,

  method         property_verification_method not null,
  status         property_verification_status not null,

  failure_reason text check (
    failure_reason is null or failure_reason in (
      'property_has_no_coordinates',
      'invalid_position',
      'accuracy_too_low',
      'fix_too_old',
      'outside_area',
      'implausible_movement'
    )
  ),

  -- After this a verification can no longer be attached to a new review. A
  -- check that never expires is a claim to be a current resident forever.
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now(),

  constraint property_verifications_reason_matches_status check (
    (status = 'verified' and failure_reason is null) or
    (status = 'failed'   and failure_reason is not null)
  )
);

comment on table property_verifications is
  'Verification attempts. Deliberately holds no coordinate, accuracy, distance, IP or device data: a position is an argument to the decision function and is gone when it returns.';

-- "Do I have a live verification for this property?" — the hot path, hit once
-- per review-wizard load.
create index property_verifications_live_idx
  on property_verifications (user_id, property_id, expires_at desc)
  where status = 'verified';

-- The caller's recent history, for the implausible-movement check and for a
-- moderator investigating an account.
create index property_verifications_user_idx
  on property_verifications (user_id, created_at desc);

create index property_verifications_property_idx
  on property_verifications (property_id, created_at desc);

-- ---------------------------------------------------------------------------
-- What a review now carries
-- ---------------------------------------------------------------------------

alter table reviews
  add column if not exists verification_id uuid
    references property_verifications(id) on delete set null,
  add column if not exists verified_at timestamptz;

comment on column reviews.verification_id is
  'The verification this review''s level was derived from. Server-set by livd_derive_review_verification; a client value is ignored or refused.';

comment on column reviews.verified_at is
  'When that verification happened. Never rendered publicly at finer than relative-time precision.';

create index if not exists reviews_verification_idx
  on reviews (verification_id) where verification_id is not null;

-- ---------------------------------------------------------------------------
-- Geometry
--
-- Mirrors src/lib/geo/distance.ts and src/config/verification.ts. The two
-- copies exist because the decision must run where a client cannot reach it,
-- and the local development adapter has no Postgres; tests/verification/
-- parity.test.ts is what keeps them from drifting.
-- ---------------------------------------------------------------------------

-- Mean Earth radius, metres. WGS-84 authalic.
create or replace function livd_earth_radius_meters()
returns numeric language sql immutable as $$ select 6371008.8::numeric $$;

/** Great-circle distance in metres. Haversine — see the note in distance.ts. */
create or replace function livd_haversine_meters(
  lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric
)
returns numeric
language sql
immutable
as $$
  select 2 * livd_earth_radius_meters() * asin(least(1, sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2))
    * power(sin(radians(lon2 - lon1) / 2), 2)
  )))::numeric;
$$;

/*
 * The verification radius for a market, in metres.
 *
 * One value today. `VERIFICATION_GEO.radiusOverridesByCountry` in the
 * application is the same decision expressed as data and is deliberately
 * empty: 150m is defensible for the markets Livd serves, and a table of
 * per-country numbers invented without measurement would be fabricated
 * precision. Add an override there and it must be added here too — the parity
 * test asserts the map is empty precisely so that cannot be forgotten.
 */
create or replace function livd_verification_radius_meters(country char(2))
returns numeric
language sql
immutable
as $$ select 150::numeric $$;

/*
 * How far from the stored coordinate still counts, for this property.
 *
 * Three terms, and each one is here because leaving it out rejects real
 * residents:
 *
 *   radius   the property's own extent and its immediate surroundings.
 *   grid     `properties.latitude/longitude` are numeric(6,3) and a trigger
 *            rounds them, so a stored coordinate names a ~110m cell rather
 *            than a point. Half a cell in each axis, at this latitude,
 *            combined as a diagonal — up to about 79m the building could be
 *            from where the row says it is. Ignoring this would silently
 *            shrink the radius and turn away someone standing in their own
 *            lobby.
 *   accuracy what the phone itself admits it does not know, capped at 75m so
 *            nobody can widen the radius by declaring a bad fix.
 */
create or replace function livd_proximity_budget_meters(
  property_latitude numeric,
  country char(2),
  reported_accuracy_meters numeric
)
returns numeric
language sql
immutable
as $$
  select
    livd_verification_radius_meters(country)
    + sqrt(
        power(0.0005 * (pi() / 180) * livd_earth_radius_meters(), 2)
      + power(0.0005 * (pi() / 180) * livd_earth_radius_meters()
              * cos(radians(property_latitude)), 2)
      )
    + least(greatest(reported_accuracy_meters, 0), 75);
$$;

-- ---------------------------------------------------------------------------
-- The decision
-- ---------------------------------------------------------------------------

/*
 * Verify that the caller is at a property.
 *
 * SECURITY DEFINER and granted to `authenticated`, which is the whole design:
 * the browser's own session can ask for a verdict, and cannot write the table
 * that records it. `anon` and `public` are revoked below.
 *
 * The position arrives as five arguments and leaves as a boolean. Nothing is
 * stored from it.
 *
 * The order of the checks is not arbitrary. The cheap, non-revealing refusals
 * come first and `outside_area` comes last, so someone probing for a
 * property's real position learns only that they were refused — never by how
 * much they missed.
 */
create or replace function livd_verify_property_location(
  target_property_id       uuid,
  reported_latitude        numeric,
  reported_longitude       numeric,
  reported_accuracy_meters numeric,
  fix_captured_at          timestamptz
)
returns table (
  verification_id uuid,
  status          property_verification_status,
  failure_reason  text,
  expires_at      timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Mirrors VERIFICATION_GEO / VERIFICATION_LIFETIME in
  -- src/config/verification.ts. Held together by the parity test.
  max_accuracy_meters   constant numeric := 250;
  max_fix_age_seconds   constant numeric := 300;
  implausible_speed_kmh constant numeric := 1000;
  attach_window_minutes constant integer := 120;

  -- A throttle *inside* the decision, not only in the Server Action above it.
  -- The action's limit is the one people meet; this one is what stops a script
  -- calling the RPC directly with the public anon key.
  max_attempts_per_hour constant integer := 20;

  caller        uuid := auth.uid();
  prop          record;
  previous      record;
  attempts      integer;
  fix_age       numeric;
  distance      numeric;
  budget        numeric;
  outcome       property_verification_status;
  reason        text := null;
  expiry        timestamptz;
  inserted      uuid;
begin
  if caller is null then
    raise exception 'Sign in to verify a property.' using errcode = '42501';
  end if;

  if not livd_is_active_user() then
    raise exception 'This account cannot verify a property.' using errcode = '42501';
  end if;

  select count(*) into attempts
  from property_verifications
  where user_id = caller and created_at > now() - interval '1 hour';

  if attempts >= max_attempts_per_hour then
    raise exception 'Too many verification attempts. Try again later.'
      using errcode = '53400';
  end if;

  select p.latitude, p.longitude, p.country_code
    into prop
  from properties p
  where p.id = target_property_id and p.status = 'active';

  if not found then
    raise exception 'No such property.' using errcode = 'P0002';
  end if;

  expiry := now() + make_interval(mins => attach_window_minutes);

  /* --- Is this property verifiable at all? --------------------------- */
  if prop.latitude is null or prop.longitude is null then
    reason := 'property_has_no_coordinates';

  /* --- Is this a position? ------------------------------------------ */
  elsif reported_latitude is null or reported_longitude is null
     or reported_accuracy_meters is null or fix_captured_at is null
     or reported_latitude  not between -90  and 90
     or reported_longitude not between -180 and 180
     or (reported_latitude = 0 and reported_longitude = 0)
     -- A non-positive accuracy is not a very good fix; it is a made-up one.
     or reported_accuracy_meters <= 0 then
    reason := 'invalid_position';

  elsif reported_accuracy_meters > max_accuracy_meters then
    reason := 'accuracy_too_low';

  else
    -- A fix from an hour ago says where the phone was, not where it is. Cheap
    -- to forge and cheap to require, which removes the laziest replay outright.
    -- The negative bound tolerates ordinary clock skew between a handset and a
    -- server while refusing a timestamp from next week.
    fix_age := extract(epoch from (now() - fix_captured_at));

    if fix_age > max_fix_age_seconds or fix_age < -max_fix_age_seconds then
      reason := 'fix_too_old';
    else
      /* --- Could the same person have been at both? ------------------ */
      --
      -- Measured between the two *properties'* published coordinates and the
      -- interval between the attempts. It therefore needs no record of where
      -- anyone has been, and creates none: both coordinates are already public
      -- facts about buildings. Threshold set above commercial aviation, so
      -- travel is never the explanation.
      select v.created_at, p2.latitude, p2.longitude
        into previous
      from property_verifications v
      join properties p2 on p2.id = v.property_id
      where v.user_id = caller
        and v.status = 'verified'
        and v.property_id <> target_property_id
        and v.created_at > now() - interval '1 hour'
        and p2.latitude is not null
      order by v.created_at desc
      limit 1;

      if found
         and livd_haversine_meters(
               previous.latitude, previous.longitude, prop.latitude, prop.longitude
             ) >= 1000
         and (
           livd_haversine_meters(
             previous.latitude, previous.longitude, prop.latitude, prop.longitude
           ) / 1000
         ) / greatest(
               extract(epoch from (now() - previous.created_at)) / 3600, 0.0001
             ) > implausible_speed_kmh then
        reason := 'implausible_movement';
      else
        distance := livd_haversine_meters(
          prop.latitude, prop.longitude, reported_latitude, reported_longitude
        );
        budget := livd_proximity_budget_meters(
          prop.latitude, prop.country_code, reported_accuracy_meters
        );

        if distance > budget then
          reason := 'outside_area';
        end if;
      end if;
    end if;
  end if;

  outcome := case when reason is null then 'verified' else 'failed' end;

  insert into property_verifications
    (user_id, property_id, method, status, failure_reason, expires_at)
  values
    (caller, target_property_id, 'location', outcome, reason, expiry)
  returning id into inserted;

  return query
    select inserted, outcome, reason,
           case when outcome = 'verified' then expiry else null end;
end;
$$;

comment on function livd_verify_property_location(uuid, numeric, numeric, numeric, timestamptz) is
  'Decides whether the caller is at a property. Takes a position as arguments and stores none of it. SECURITY DEFINER so the verdict cannot be asserted by the caller.';

-- ---------------------------------------------------------------------------
-- Deriving a review's level
--
-- The single control that makes every badge on the site mean something.
-- ---------------------------------------------------------------------------

create or replace function livd_derive_review_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
begin
  -- Only inserts that arrive with a caller are constrained. Service-role work
  -- — the seed script, a migration, a moderator tool — has already bypassed
  -- RLS entirely and holds the one real secret in the application; there is
  -- nothing left for this to defend against. Gating here rather than trusting
  -- a role name keeps the check on exactly the untrusted path.
  if auth.uid() is null then
    return new;
  end if;

  if new.verification_id is null then
    new.verification_level := 'unverified';
    new.verified_at := null;
    return new;
  end if;

  select pv.user_id, pv.property_id, pv.method, pv.status, pv.expires_at, pv.created_at
    into v
  from property_verifications pv
  where pv.id = new.verification_id;

  -- A verification that is not this person's, or not this property's, is not a
  -- mistake to be forgiven quietly. Verify property A, submit a review of
  -- property B, and the insert fails.
  if not found
     or v.user_id <> new.author_id
     or v.user_id <> auth.uid()
     or v.property_id <> new.property_id
     or v.status <> 'verified' then
    raise exception 'That verification does not belong to this review.'
      using errcode = '42501';
  end if;

  -- Expiry, by contrast, is ordinary and is forgiven. Someone who verified,
  -- was interrupted and came back three hours later gets a published,
  -- unverified review — never an error page in front of what they just wrote.
  if v.expires_at <= now() then
    new.verification_id := null;
    new.verification_level := 'unverified';
    new.verified_at := null;
    return new;
  end if;

  new.verification_level := case v.method
    when 'location' then 'location_verified'::verification_level
    -- Every other method is a moderator decision that has not been built yet.
    -- Until one is, the honest derivation is "nothing established".
    else 'unverified'::verification_level
  end;
  new.verified_at := v.created_at;

  return new;
end;
$$;

create trigger reviews_derive_verification
  before insert on reviews
  for each row execute function livd_derive_review_verification();

-- ---------------------------------------------------------------------------
-- The edit window may not touch any of this
--
-- Recreated rather than altered, so the whole list of immutable columns reads
-- in one place. `verification_id` and `verified_at` join it: a review whose
-- verification could be swapped after publication would make the badge
-- meaningless, and this is the same reason `verification_level` and
-- `property_id` have been on the list since 0004.
-- ---------------------------------------------------------------------------

create or replace function livd_guard_review_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if livd_is_moderator() then
    return new;
  end if;

  if new.status             is distinct from old.status
     or new.verification_level is distinct from old.verification_level
     or new.verification_id is distinct from old.verification_id
     or new.verified_at     is distinct from old.verified_at
     or new.property_id     is distinct from old.property_id
     or new.author_id       is distinct from old.author_id
     or new.overall_rating  is distinct from old.overall_rating
     or new.residency_status is distinct from old.residency_status
     or new.moved_in_month  is distinct from old.moved_in_month
     or new.moved_out_month is distinct from old.moved_out_month
     or new.helpful_count   is distinct from old.helpful_count
     or new.is_demo         is distinct from old.is_demo then
    raise exception 'Only the written review and recommendation may be corrected';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Read: your own, and a moderator's.
--
-- Write: nobody. There is no insert, update or delete policy on this table for
-- any client role, so the only way a row appears is through
-- `livd_verify_property_location`, which decides before it writes. That is the
-- difference between a verification and a claim to have been verified.
--
-- A property owner is not mentioned anywhere in this file, and that is the
-- point. An approved claimant of a property has no policy granting them
-- anything on `property_verifications`, so "who verified themselves at my
-- building, and when" is a question the schema cannot answer for them.
-- ---------------------------------------------------------------------------

alter table property_verifications enable row level security;

create policy property_verifications_read_own on property_verifications
  for select using (user_id = auth.uid() or livd_is_moderator());

-- ---------------------------------------------------------------------------
-- Grants
--
-- `revoke ... from public` alone would not do it: Supabase's default privileges
-- grant EXECUTE directly to anon, authenticated and service_role, so PUBLIC is
-- one grant of four. See 0008 for the same trap.
--
-- The verification function is the one exception in this codebase to "no
-- browser-callable function": it is granted to `authenticated` on purpose,
-- because it is the thing that makes a verdict rather than accepting one, and
-- because this deployment has no service-role key for a Server Action to use.
-- ---------------------------------------------------------------------------

revoke execute on function livd_verify_property_location(uuid, numeric, numeric, numeric, timestamptz)
  from public, anon;

grant execute on function livd_verify_property_location(uuid, numeric, numeric, numeric, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Keeping the trail bounded
--
-- Successes that are still attached to a review are kept: they are the
-- provenance of a badge that is on the site. Everything else — expired
-- successes nobody used, and failures — ages out, because an audit trail that
-- grows without limit is a liability rather than a control.
-- ---------------------------------------------------------------------------

create or replace function livd_prune_property_verifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from property_verifications v
  where v.created_at < now() - interval '90 days'
    and not exists (select 1 from reviews r where r.verification_id = v.id);

  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function livd_prune_property_verifications()
  from public, anon, authenticated;

select cron.schedule(
  'livd-prune-property-verifications',
  '53 3 * * *',
  'select livd_prune_property_verifications();'
);

-- ---------------------------------------------------------------------------
-- The rollup
--
-- Two changes, both consequences of there now being more than one way to be
-- verified.
--
--   `livd_verification_weight` learns the new level. 1.3, between an unchecked
--   claim and a tenancy agreement a person has read — see
--   VERIFICATION_WEIGHTS.location for why that number and not another.
--
--   `verified_review_count` starts counting both levels, because it is what
--   the "Verified" filter on a property page counts, and a filter labelled
--   "verified" that silently excludes half of the verified reviews is a lie in
--   the interface rather than a subtlety in the schema.
-- ---------------------------------------------------------------------------

create or replace function livd_verification_weight(level verification_level)
returns numeric
language sql
immutable
as $$
  select case level
    when 'verified_resident' then 1.8
    when 'location_verified' then 1.3
    when 'disputed'          then 0.0
    else 1.0
  end;
$$;

create or replace function livd_refresh_property_stats(target_property_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  prior          constant numeric := 65;
  prior_weight   constant numeric := 5;
  overall_blend  constant numeric := 0.35;

  weight_sum     numeric := 0;
  weighted_score numeric := 0;
  computed_score int;
  computed_confidence text;
  stats record;
begin
  with review_scores as (
    select
      r.id,
      livd_recency_weight(coalesce(r.moved_out_month, r.created_at::date))
        * livd_verification_weight(r.verification_level) as weight,
      livd_rating_to_score(r.overall_rating) as overall_score,
      (
        select sum(livd_rating_to_score(rc.rating) * d.weight) / nullif(sum(d.weight), 0)
        from review_category_ratings rc
        join review_category_defs d on d.key = rc.category_key
        where rc.review_id = r.id
      ) as category_score
    from reviews r
    where r.property_id = target_property_id
      and r.status = 'published'
  )
  select
    coalesce(sum(weight), 0),
    coalesce(sum(
      weight * case
        when category_score is null then overall_score
        else overall_score * overall_blend + category_score * (1 - overall_blend)
      end
    ), 0)
  into weight_sum, weighted_score
  from review_scores;

  computed_confidence := case
    when weight_sum >= 14 then 'strong'
    when weight_sum >= 6  then 'moderate'
    when weight_sum >= 3  then 'limited'
    else 'insufficient'
  end;

  computed_score := case
    when computed_confidence = 'insufficient' then null
    else round((weighted_score + prior * prior_weight) / (weight_sum + prior_weight))
  end;

  select
    count(*)                                                             as review_count,
    count(*) filter (
      where verification_level in ('verified_resident', 'location_verified')
    )                                                                    as verified_count,
    count(*) filter (where residency_status = 'current')                 as current_count,
    count(*) filter (where residency_status = 'former')                  as former_count,
    max(created_at)                                                      as last_review_at,
    case when count(*) >= 4
      then round(avg(case when would_recommend then 1.0 else 0.0 end), 3)
    end                                                                  as recommend_rate
  into stats
  from reviews
  where property_id = target_property_id and status = 'published';

  insert into property_stats (
    property_id, review_count, verified_review_count, overall_score, confidence,
    effective_sample_size, recommend_rate, current_resident_count,
    former_resident_count, last_review_at, updated_at
  )
  values (
    target_property_id,
    coalesce(stats.review_count, 0),
    coalesce(stats.verified_count, 0),
    computed_score,
    computed_confidence,
    round(weight_sum, 2),
    stats.recommend_rate,
    coalesce(stats.current_count, 0),
    coalesce(stats.former_count, 0),
    stats.last_review_at,
    now()
  )
  on conflict (property_id) do update set
    review_count           = excluded.review_count,
    verified_review_count  = excluded.verified_review_count,
    overall_score          = excluded.overall_score,
    confidence             = excluded.confidence,
    effective_sample_size  = excluded.effective_sample_size,
    recommend_rate         = excluded.recommend_rate,
    current_resident_count = excluded.current_resident_count,
    former_resident_count  = excluded.former_resident_count,
    last_review_at         = excluded.last_review_at,
    updated_at             = now();
end;
$$;

-- Every property's rollup is now computed under a weighting that did not exist
-- when it was last written. Nothing changes for existing rows — no review has a
-- location verification yet — but leaving the two definitions disagreeing would
-- mean the first review published after this migration recomputed a property
-- onto a different basis than its neighbours.
do $$
declare
  target uuid;
begin
  for target in select id from properties loop
    perform livd_refresh_property_stats(target);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Nearby properties
--
-- For the opt-in "properties near you" on search. Reads only what is already
-- public — a property's own published coordinate — and takes the visitor's
-- position as arguments it does not store, exactly as the verification
-- function does.
--
-- Not SECURITY DEFINER: it needs no privilege the caller does not have, and it
-- runs under the caller's own RLS so a non-active property stays invisible.
-- Granted to anon as well as authenticated, because finding out what is around
-- you should not require an account.
-- ---------------------------------------------------------------------------

create or replace function livd_properties_near(
  origin_latitude  numeric,
  origin_longitude numeric,
  radius_meters    numeric default 2000,
  result_limit     integer default 12
)
returns table (property_id uuid, distance_meters numeric)
language sql
stable
as $$
  with bounds as (
    select
      least(greatest(radius_meters, 100), 20000) as r,
      -- A cheap bounding box before the trigonometry, so this is an index-free
      -- scan of a few rows rather than a haversine against every property.
      least(greatest(radius_meters, 100), 20000) / 111320.0 as lat_delta
  )
  select
    p.id,
    livd_haversine_meters(p.latitude, p.longitude, origin_latitude, origin_longitude)
  from properties p, bounds b
  where p.status = 'active'
    and p.latitude is not null
    and p.longitude is not null
    and origin_latitude between -90 and 90
    and origin_longitude between -180 and 180
    and p.latitude  between origin_latitude  - b.lat_delta and origin_latitude  + b.lat_delta
    and p.longitude between origin_longitude - (b.lat_delta / greatest(cos(radians(origin_latitude)), 0.01))
                        and origin_longitude + (b.lat_delta / greatest(cos(radians(origin_latitude)), 0.01))
    and livd_haversine_meters(p.latitude, p.longitude, origin_latitude, origin_longitude) <= b.r
  order by 2 asc
  limit least(greatest(result_limit, 1), 24);
$$;

comment on function livd_properties_near(numeric, numeric, numeric, integer) is
  'Properties within a radius of a point. Takes the visitor position as arguments and stores nothing; returns only public property ids.';
