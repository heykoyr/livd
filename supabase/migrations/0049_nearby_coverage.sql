-- ---------------------------------------------------------------------------
-- 0049 — Nearby search: exclude seeded data, and index the coordinates
--
-- Two defects in the proximity path, both found by tracing why a resident
-- standing inside a property they had reviewed was told there was nothing near
-- them.
--
-- The cause of that specific failure was neither of these: it was the property
-- having no coordinates at all, because no geocoder was configured when it was
-- added, and `livd_properties_near` correctly refuses to measure a null
-- position. That is a data and configuration problem and is handled in the
-- application, which now says so rather than reporting an empty area. These two
-- are what the same trace turned up on the way.
--
-- 1. `livd_properties_near` predates `is_demo` and never learned about it, so
--    it returned seeded demonstration properties alongside real ones. Every
--    other read path in the application honours the flag; this one silently did
--    not, which meant sample data could appear as a real building near you.
--
--    The application also filters demo rows on the way back, so this is defence
--    in depth rather than the only guard — a deployment that has not applied
--    this migration still excludes them. Doing it here as well keeps the
--    function's own answer correct for any future caller.
--
-- 2. There was no index on the coordinate columns at all. The function's
--    bounding-box prefilter was therefore a sequential scan, which its own
--    comment described as "an index-free scan of a few rows" — true at
--    eighteen properties and false at scale.
--
-- On PostGIS, deliberately not used. It is available on this instance and not
-- installed, and installing it would mean a new extension, a geography column,
-- a spatial index, a backfill, and rewriting a distance decision that is
-- mirrored in TypeScript for the local adapter and pinned by
-- `tests/verification/parity.test.ts`. The haversine already here is exact, and
-- a partial B-tree on (latitude, longitude) makes the prefilter that precedes
-- it index-backed — which is the actual cost at any realistic size for a query
-- of this shape. Revisit when properties are dense enough per city that the
-- bounding box stops being selective, not before.
-- ---------------------------------------------------------------------------

-- 1. Coordinates, indexed. Partial: a row with no position can never match a
--    bounding box, so it has no business in the index.
create index if not exists properties_coordinates_idx
  on properties (latitude, longitude)
  where status = 'active'
    and latitude is not null
    and longitude is not null;

-- 2. The same function, with seeded data excluded and the demo flag honoured
--    the way every other read path honours it.
--
--    The old four-argument version is dropped rather than kept alongside this
--    one. Two overloads differing only by a defaulted parameter are ambiguous
--    to resolve — Postgres refuses a four-argument call with "function is not
--    unique" — so keeping both would break every existing caller instead of
--    none. With a single function, a caller passing four named arguments
--    resolves here and takes the default, which is what the application does
--    until it is deployed with the fifth.
drop function if exists livd_properties_near(numeric, numeric, numeric, integer);

create or replace function livd_properties_near(
  origin_latitude  numeric,
  origin_longitude numeric,
  radius_meters    numeric default 2000,
  result_limit     integer default 12,
  -- Defaults to excluding demo data: a caller that says nothing gets the
  -- conservative answer. The application passes this explicitly from
  -- `showDemoData()`.
  include_demo     boolean default false
)
returns table (property_id uuid, distance_meters numeric)
language sql
stable
set search_path = public
as $$
  with bounds as (
    select
      least(greatest(radius_meters, 100), 20000) as r,
      -- A cheap bounding box before the trigonometry, so this is an indexed
      -- range scan of a few rows rather than a haversine against every
      -- property. `properties_coordinates_idx` is what makes it one.
      least(greatest(radius_meters, 100), 20000) / 111320.0 as lat_delta
  )
  select
    p.id,
    livd_haversine_meters(p.latitude, p.longitude, origin_latitude, origin_longitude)
  from properties p, bounds b
  where p.status = 'active'
    and p.latitude is not null
    and p.longitude is not null
    and (include_demo or not p.is_demo)
    and origin_latitude between -90 and 90
    and origin_longitude between -180 and 180
    and p.latitude  between origin_latitude  - b.lat_delta and origin_latitude  + b.lat_delta
    and p.longitude between origin_longitude - (b.lat_delta / greatest(cos(radians(origin_latitude)), 0.01))
                        and origin_longitude + (b.lat_delta / greatest(cos(radians(origin_latitude)), 0.01))
    and livd_haversine_meters(p.latitude, p.longitude, origin_latitude, origin_longitude) <= b.r
  order by 2 asc
  limit least(greatest(result_limit, 1), 24);
$$;

comment on function livd_properties_near(numeric, numeric, numeric, integer, boolean) is
  'Properties within a radius of a point. Takes the visitor position as arguments and stores nothing; returns only public property ids. Excludes seeded demonstration data unless asked for it.';

-- Same grants as the original: anonymous callers may ask what is near a point.
-- No session is involved and no row is written, so there is nothing here that
-- an account would make safer.
revoke execute on function livd_properties_near(numeric, numeric, numeric, integer, boolean) from public;
grant execute on function livd_properties_near(numeric, numeric, numeric, integer, boolean) to anon, authenticated;
