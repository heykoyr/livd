-- ===========================================================================
-- Livd — 0003 · Functions, triggers and search
--
-- The score is computed in two places: TypeScript (`src/lib/intelligence/`),
-- which is authoritative and what the property page renders, and here, which
-- maintains a denormalised copy so search and list ordering do not have to load
-- every review.
--
-- The constants below are the same ones named in `SCORING`. They are duplicated
-- deliberately and must be changed together; `tests/intelligence/parity.test.ts`
-- documents the pairing.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Slug generation
-- ---------------------------------------------------------------------------

create or replace function livd_slugify(value text)
returns text
language sql
immutable
as $$
  select trim(both '-' from
    regexp_replace(
      lower(unaccent(coalesce(value, ''))),
      '[^a-z0-9]+', '-', 'g'
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- Scoring
-- ---------------------------------------------------------------------------

-- A 1–5 rating on the 0–100 scale. 3/5 is 50 — genuinely mixed.
create or replace function livd_rating_to_score(rating numeric)
returns numeric
language sql
immutable
as $$
  select ((least(5, greatest(1, rating)) - 1) / 4.0) * 100;
$$;

-- Recency decay: halves every 30 months, floored at 0.25.
create or replace function livd_recency_weight(reference_date date)
returns numeric
language sql
stable
as $$
  select greatest(
    0.25,
    power(
      0.5,
      greatest(0, (extract(year from age(current_date, reference_date)) * 12
                 + extract(month from age(current_date, reference_date)))) / 30.0
    )
  );
$$;

-- A verified resident's review carries 1.8 of an unverified one. A disputed
-- review contributes nothing until the dispute is resolved.
create or replace function livd_verification_weight(level verification_level)
returns numeric
language sql
immutable
as $$
  select case level
    when 'verified_resident' then 1.8
    when 'disputed'          then 0.0
    else 1.0
  end;
$$;

/*
 * Recomputes a property's rollup.
 *
 * Mirrors `buildPropertyIntelligence`: each review collapses to one score
 * (35% the resident's overall verdict, 65% their category detail weighted by
 * category importance), each is weighted by recency and verification, and the
 * weighted mean is shrunk toward a prior of 65 carrying the weight of five
 * reviews.
 */
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
  -- One score and one weight per published review.
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
    count(*) filter (where verification_level = 'verified_resident')     as verified_count,
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

-- ---------------------------------------------------------------------------
-- Triggers keeping the rollup current
-- ---------------------------------------------------------------------------

create or replace function livd_reviews_refresh_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform livd_refresh_property_stats(old.property_id);
    return old;
  end if;

  perform livd_refresh_property_stats(new.property_id);

  -- A review moved between properties refreshes both.
  if tg_op = 'UPDATE' and old.property_id is distinct from new.property_id then
    perform livd_refresh_property_stats(old.property_id);
  end if;

  return new;
end;
$$;

create trigger reviews_refresh_stats
  after insert or update or delete on reviews
  for each row execute function livd_reviews_refresh_stats();

create or replace function livd_category_refresh_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected uuid;
begin
  select property_id into affected
  from reviews
  where id = coalesce(new.review_id, old.review_id);

  if affected is not null then
    perform livd_refresh_property_stats(affected);
  end if;

  return coalesce(new, old);
end;
$$;

create trigger review_category_ratings_refresh_stats
  after insert or update or delete on review_category_ratings
  for each row execute function livd_category_refresh_stats();

-- Helpful votes are a ranking signal and never affect a score, so the counter
-- is maintained directly rather than through the stats refresh.
create or replace function livd_sync_helpful_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update reviews r
  set helpful_count = (
    select count(*) from review_helpful_votes v where v.review_id = r.id
  )
  where r.id = coalesce(new.review_id, old.review_id);

  return coalesce(new, old);
end;
$$;

create trigger review_helpful_votes_sync
  after insert or delete on review_helpful_votes
  for each row execute function livd_sync_helpful_count();

-- A new property starts with an empty rollup, so every property has a stats row.
create or replace function livd_property_init_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into property_stats (property_id) values (new.id)
  on conflict (property_id) do nothing;
  return new;
end;
$$;

create trigger properties_init_stats
  after insert on properties
  for each row execute function livd_property_init_stats();

-- ---------------------------------------------------------------------------
-- Search
--
-- Combines full-text rank with trigram similarity, over property fields and
-- aliases, so "Adminralty Way" still finds "Admiralty Way".
-- ---------------------------------------------------------------------------

create or replace function livd_property_search(
  search_query text,
  filter_country char(2) default null,
  result_limit int default 24,
  result_offset int default 0
)
returns table (
  property_id uuid,
  rank numeric,
  is_fuzzy boolean
)
language sql
stable
as $$
  with normalised as (
    select lower(unaccent(trim(search_query))) as q
  ),
  scored as (
    select
      p.id,
      -- Full-text rank, scaled to be comparable with similarity.
      coalesce(
        ts_rank(p.search_vector, plainto_tsquery('simple', (select q from normalised))),
        0
      ) * 4 as text_rank,
      greatest(
        similarity(lower(unaccent(coalesce(p.building_name, ''))),  (select q from normalised)),
        similarity(lower(unaccent(coalesce(p.street_address, ''))), (select q from normalised)),
        similarity(lower(unaccent(coalesce(p.neighbourhood, ''))),  (select q from normalised)),
        similarity(lower(unaccent(p.locality)),                     (select q from normalised)),
        coalesce((
          select max(similarity(lower(unaccent(a.alias)), (select q from normalised)))
          from property_aliases a where a.property_id = p.id
        ), 0)
      ) as trgm_score
    from properties p
    where p.status = 'active'
      and (filter_country is null or p.country_code = filter_country)
  )
  select
    s.id,
    (s.text_rank + s.trgm_score)::numeric as rank,
    (s.text_rank = 0) as is_fuzzy
  from scored s
  left join property_stats ps on ps.property_id = s.id
  where s.text_rank > 0 or s.trgm_score >= 0.28
  order by rank desc, coalesce(ps.review_count, 0) desc
  limit result_limit
  offset result_offset;
$$;

-- ---------------------------------------------------------------------------
-- Coordinate precision
--
-- Enforced in the database rather than trusted from the application, so no
-- future code path can store a unit-precise location.
-- ---------------------------------------------------------------------------

create or replace function livd_round_coordinates()
returns trigger
language plpgsql
as $$
begin
  new.latitude  := round(new.latitude, 3);
  new.longitude := round(new.longitude, 3);
  return new;
end;
$$;

create trigger properties_round_coordinates
  before insert or update of latitude, longitude on properties
  for each row execute function livd_round_coordinates();
