-- ===========================================================================
-- Livd — 0052 · Sample data at scale
--
-- The seeded sample dataset grows from sixteen properties to several thousand,
-- spread across real cities and neighbourhoods in every supported market. Four
-- things in the schema were only correct while the dataset was tiny, and each
-- is fixed here rather than worked around in the seed.
--
-- 1. PLACE AGGREGATES WERE BUILT IN JAVASCRIPT FROM EVERY ROW.
--
--    `listLocalities` and `listNeighbourhoods` selected one row per property
--    and counted them in the application. PostgREST caps a response at its
--    `max_rows` (1,000 on this project), so past that size the counts on the
--    Explore, country, directory and sitemap pages would have been silently
--    wrong — short, with no error — and a country with more than a thousand
--    properties would have lost cities from its own page. The aggregates move
--    into Postgres, where they are one small result whatever the table size.
--
--    `livd_place_overview` does the same for a city or neighbourhood page's
--    headline figures, which were computed by loading every review in the
--    city. It reads the `property_stats` rollup, which exists precisely so that
--    list-level figures never recompute scores.
--
--    `livd_place_property_ids` pages a place's properties in the same order
--    the page always used (most reviewed first), with the same matching rule
--    as the overview, so the grid and its figures cannot disagree about which
--    properties are "in Lagos".
--
--    Every function takes `include_demo`, defaulting to false, exactly as
--    `livd_properties_near` does (0049). The application passes it from
--    `showDemoData()`, so one setting governs every read.
--
--    All four are SECURITY INVOKER. They read only what `anon` can already
--    read — active properties and their public rollup — and RLS still decides
--    which rows that is.
--
-- 2. A SAMPLE PROPERTY COULD BLOCK A REAL ONE.
--
--    `properties_address_unique` made no distinction between seeded and real
--    rows. With thousands of synthetic building names, a resident adding their
--    own building with a coincidentally identical name in the same city would
--    have been refused by the index — or, worse, matched to the sample
--    property as a "duplicate" and had their real review attached to
--    fabricated data that disappears when sample data is switched off.
--
--    The index is split. Real properties are unique among real properties;
--    sample properties are unique among sample properties; neither can block
--    the other. The application's duplicate check ignores sample rows to match.
--
-- 3. THE ADMIN PLATFORM COUNTS COUNTED SAMPLE DATA.
--
--    `livd_admin_attention` reported properties, reviews, accounts and
--    "reviews, 30 days" including every seeded row. At sixteen properties that
--    was a rounding error; at several thousand it would make the dashboard's
--    "the number that matters" a count of the seed. The four platform figures
--    now exclude sample data — rows marked `is_demo`, and accounts on the
--    reserved `demo.livd.invalid` domain the seed has always used. This is a
--    change of definition, made visibly: the dashboard says so beneath the
--    figures. Every queue and case count is untouched; the seed never creates
--    anything that would appear in one.
--
-- Nothing here reads or writes a review body, an author or a position.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Address uniqueness, split by provenance
--
-- Created before the old index is dropped, in the same transaction, so there
-- is no moment at which the table has no uniqueness rule at all.
-- ---------------------------------------------------------------------------

create unique index if not exists properties_real_address_unique on properties (
  country_code,
  lower(locality),
  lower(coalesce(street_address, '')),
  lower(coalesce(building_name, ''))
) where status = 'active' and not is_demo;

create unique index if not exists properties_demo_address_unique on properties (
  country_code,
  lower(locality),
  lower(coalesce(street_address, '')),
  lower(coalesce(building_name, ''))
) where status = 'active' and is_demo;

drop index if exists properties_address_unique;

-- ---------------------------------------------------------------------------
-- 2. The matching rule for a place name
--
-- The SQL twin of `normaliseForSearch` in src/lib/search/matching.ts:
-- accent-folded, lowercased, punctuation to spaces, whitespace collapsed. It
-- is what makes `/places/gb/london`, "London" and "london " the same city,
-- and "Hell's Kitchen" and "hells kitchen" the same neighbourhood.
-- ---------------------------------------------------------------------------

create or replace function livd_place_key(value text)
returns text
language sql
stable
set search_path = public
as $$
  select trim(
    regexp_replace(
      regexp_replace(lower(unaccent(coalesce(value, ''))), '[^a-z0-9[:space:]]+', ' ', 'g'),
      '[[:space:]]+', ' ', 'g'
    )
  );
$$;

comment on function livd_place_key(text) is
  'Folds a city or neighbourhood name to the key places are grouped and matched by. Mirrors normaliseForSearch in the application.';

-- ---------------------------------------------------------------------------
-- 3. Cities
-- ---------------------------------------------------------------------------

create or replace function livd_locality_summaries(
  filter_country char(2) default null,
  include_demo   boolean default false
)
returns table (
  country_code        char(2),
  locality            text,
  admin_area          text,
  property_count      bigint,
  review_count        bigint,
  demo_property_count bigint
)
language sql
stable
set search_path = public
as $$
  select
    p.country_code,
    -- The spelling most of the city's properties use, so one mistyped entry
    -- cannot rename a city on its own page.
    mode() within group (order by p.locality)   as locality,
    mode() within group (order by p.admin_area) as admin_area,
    count(*)                                    as property_count,
    coalesce(sum(ps.review_count), 0)           as review_count,
    count(*) filter (where p.is_demo)           as demo_property_count
  from properties p
  left join property_stats ps on ps.property_id = p.id
  where p.status = 'active'
    and (include_demo or not p.is_demo)
    and (filter_country is null or p.country_code = upper(filter_country))
  group by p.country_code, livd_place_key(p.locality)
  order by review_count desc, locality asc;
$$;

comment on function livd_locality_summaries(char, boolean) is
  'Cities with at least one active property, with property and review counts. Aggregated in the database so the answer is complete at any size. Excludes seeded sample data unless asked for it.';

-- ---------------------------------------------------------------------------
-- 4. Neighbourhoods
-- ---------------------------------------------------------------------------

create or replace function livd_neighbourhood_summaries(
  filter_country  char(2) default null,
  filter_locality text    default null,
  include_demo    boolean default false,
  result_limit    integer default null
)
returns table (
  country_code        char(2),
  locality            text,
  neighbourhood       text,
  property_count      bigint,
  review_count        bigint,
  demo_property_count bigint
)
language sql
stable
set search_path = public
as $$
  select
    p.country_code,
    mode() within group (order by p.locality)      as locality,
    mode() within group (order by p.neighbourhood) as neighbourhood,
    count(*)                                       as property_count,
    coalesce(sum(ps.review_count), 0)              as review_count,
    count(*) filter (where p.is_demo)              as demo_property_count
  from properties p
  left join property_stats ps on ps.property_id = p.id
  where p.status = 'active'
    and p.neighbourhood is not null
    and livd_place_key(p.neighbourhood) <> ''
    and (include_demo or not p.is_demo)
    and (filter_country is null or p.country_code = upper(filter_country))
    and (filter_locality is null or livd_place_key(p.locality) = livd_place_key(filter_locality))
  group by p.country_code, livd_place_key(p.locality), livd_place_key(p.neighbourhood)
  order by review_count desc, property_count desc, neighbourhood asc
  limit case when result_limit is null then null else greatest(result_limit, 0) end;
$$;

comment on function livd_neighbourhood_summaries(char, text, boolean, integer) is
  'Neighbourhoods named on active properties, ranked by how much residents have written about them. Excludes seeded sample data unless asked for it.';

-- ---------------------------------------------------------------------------
-- 5. A place's headline figures
--
-- One row, or none when nothing matches. The figures are the ones the city
-- and neighbourhood pages print: how many properties and reviews, the median
-- score across properties that have one, and the mean would-return rate
-- across properties with at least moderate evidence.
-- ---------------------------------------------------------------------------

create or replace function livd_place_overview(
  filter_country       char(2),
  filter_locality      text,
  filter_neighbourhood text    default null,
  include_demo         boolean default false
)
returns table (
  locality            text,
  neighbourhood       text,
  admin_area          text,
  property_count      bigint,
  review_count        bigint,
  scored_count        bigint,
  median_score        integer,
  evidenced_count     bigint,
  recommend_rate      numeric,
  demo_property_count bigint
)
language sql
stable
set search_path = public
as $$
  select
    mode() within group (order by p.locality)      as locality,
    mode() within group (order by p.neighbourhood) as neighbourhood,
    mode() within group (order by p.admin_area)    as admin_area,
    count(*)                                        as property_count,
    coalesce(sum(ps.review_count), 0)               as review_count,
    count(ps.overall_score)                         as scored_count,
    round(percentile_cont(0.5) within group (order by ps.overall_score))::integer
                                                    as median_score,
    count(*) filter (where ps.confidence in ('moderate', 'strong')) as evidenced_count,
    avg(ps.recommend_rate) filter (
      where ps.confidence in ('moderate', 'strong') and ps.recommend_rate is not null
    )                                               as recommend_rate,
    count(*) filter (where p.is_demo)               as demo_property_count
  from properties p
  left join property_stats ps on ps.property_id = p.id
  where p.status = 'active'
    and (include_demo or not p.is_demo)
    and p.country_code = upper(filter_country)
    and livd_place_key(p.locality) = livd_place_key(filter_locality)
    and (
      filter_neighbourhood is null
      or livd_place_key(p.neighbourhood) = livd_place_key(filter_neighbourhood)
    )
  having count(*) > 0;
$$;

comment on function livd_place_overview(char, text, text, boolean) is
  'Headline figures for a city or neighbourhood, from the property_stats rollup. No row when nothing matches. Excludes seeded sample data unless asked for it.';

-- ---------------------------------------------------------------------------
-- 6. A page of a place's properties
--
-- Most reviewed first, then by slug so a page boundary never moves between
-- requests. `total_count` is the size of the whole place, repeated on every
-- row, so one call answers both "which" and "how many pages".
-- ---------------------------------------------------------------------------

create or replace function livd_place_property_ids(
  filter_country       char(2),
  filter_locality      text,
  filter_neighbourhood text    default null,
  include_demo         boolean default false,
  page_size            integer default 24,
  page_offset          integer default 0
)
returns table (property_id uuid, total_count bigint)
language sql
stable
set search_path = public
as $$
  select p.id, count(*) over () as total_count
  from properties p
  left join property_stats ps on ps.property_id = p.id
  where p.status = 'active'
    and (include_demo or not p.is_demo)
    and p.country_code = upper(filter_country)
    and livd_place_key(p.locality) = livd_place_key(filter_locality)
    and (
      filter_neighbourhood is null
      or livd_place_key(p.neighbourhood) = livd_place_key(filter_neighbourhood)
    )
  order by coalesce(ps.review_count, 0) desc, p.slug asc
  limit least(greatest(coalesce(page_size, 24), 1), 60)
  offset greatest(coalesce(page_offset, 0), 0);
$$;

comment on function livd_place_property_ids(char, text, text, boolean, integer, integer) is
  'One page of a city or neighbourhood''s active properties, most reviewed first, with the total. Excludes seeded sample data unless asked for it.';

-- Public reads, like every other place and property read. No row is written
-- and nothing about the caller is involved.
revoke execute on function livd_place_key(text) from public;
revoke execute on function livd_locality_summaries(char, boolean) from public;
revoke execute on function livd_neighbourhood_summaries(char, text, boolean, integer) from public;
revoke execute on function livd_place_overview(char, text, text, boolean) from public;
revoke execute on function livd_place_property_ids(char, text, text, boolean, integer, integer) from public;

grant execute on function livd_place_key(text) to anon, authenticated;
grant execute on function livd_locality_summaries(char, boolean) to anon, authenticated;
grant execute on function livd_neighbourhood_summaries(char, text, boolean, integer) to anon, authenticated;
grant execute on function livd_place_overview(char, text, text, boolean) to anon, authenticated;
grant execute on function livd_place_property_ids(char, text, text, boolean, integer, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Platform counts without the seed
--
-- The whole function, recreated, because a partial edit of a SECURITY DEFINER
-- function is how a pinned search_path goes missing (see 0016). Only the four
-- platform figures at the end differ from 0037.
-- ---------------------------------------------------------------------------

create or replace function livd_admin_attention()
returns table (
  pending_reviews         bigint,
  oldest_pending_review   timestamptz,
  open_reports            bigint,
  oldest_open_report      timestamptz,
  open_flags              bigint,
  oldest_open_flag        timestamptz,
  pending_verifications   bigint,
  oldest_pending_verification timestamptz,
  pending_claims          bigint,
  oldest_pending_claim    timestamptz,

  open_cases              bigint,
  unassigned_cases        bigint,
  my_cases                bigint,
  critical_cases          bigint,
  oldest_open_case        timestamptz,

  open_authority_requests bigint,
  preservation_holds      bigint,
  sanctions_expiring      bigint,
  refusals_7d             bigint,

  property_count          bigint,
  review_count            bigint,
  user_count              bigint,
  reviews_30d             bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  viewer    uuid := auth.uid();
  privileged boolean := livd_is_trust_admin();
begin
  if not livd_is_moderator() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  return query
  select
    (select count(*) from reviews where status = 'pending_moderation'),
    (select min(created_at) from reviews where status = 'pending_moderation'),

    (select count(*) from review_reports where status = 'open'),
    (select min(created_at) from review_reports where status = 'open'),

    (select count(*) from property_flags where status = 'open'),
    (select min(created_at) from property_flags where status = 'open'),

    (select count(*) from verification_records where outcome = 'pending'),
    (select min(created_at) from verification_records where outcome = 'pending'),

    (select count(*) from property_claims where status = 'pending'),
    (select min(created_at) from property_claims where status = 'pending'),

    (select count(*) from ts_cases
      where status not in ('resolved', 'dismissed', 'closed')),
    (select count(*) from ts_cases
      where status not in ('resolved', 'dismissed', 'closed') and assigned_to is null),
    (select count(*) from ts_cases
      where status not in ('resolved', 'dismissed', 'closed') and assigned_to = viewer),
    (select count(*) from ts_cases
      where status not in ('resolved', 'dismissed', 'closed') and priority = 'critical'),
    (select min(created_at) from ts_cases
      where status not in ('resolved', 'dismissed', 'closed')),

    case when privileged then (select count(*) from authority_requests
      where status not in ('fulfilled', 'declined', 'closed')) end,
    case when privileged then (select count(*) from ts_cases
      where preservation_hold) end,
    case when privileged then (select count(*) from user_sanctions
      where lifted_at is null
        and ends_at is not null
        and ends_at between now() and now() + interval '7 days') end,
    case when privileged then (select count(*) from admin_audit_log
      where outcome = 'denied' and created_at >= now() - interval '7 days') end,

    -- Sample data excluded. Changed in 0052; see the header.
    (select count(*) from properties where status = 'active' and not is_demo),
    (select count(*) from reviews where status = 'published' and not is_demo),
    (select count(*) from profiles p
       join auth.users u on u.id = p.id
      where coalesce(u.email, '') not like '%@demo.livd.invalid'),
    (select count(*) from reviews
      where created_at >= now() - interval '30 days' and not is_demo);
end;
$fn$;

revoke execute on function livd_admin_attention() from public, anon;
grant  execute on function livd_admin_attention() to authenticated;

comment on function livd_admin_attention() is
  'The dashboard in one query: how much is waiting and how long it has waited. Counts and ages only, never identity or content. Platform figures exclude seeded sample data (0052).';
