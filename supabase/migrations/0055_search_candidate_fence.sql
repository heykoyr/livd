-- ===========================================================================
-- Livd — 0055 · Make the search candidates actually bound the work
--
-- 0054 built an index-backed candidate set and then scored those candidates.
-- Measured against the finished sample dataset (8,216 properties) it was no
-- faster than what it replaced: 143 ms against the old 136 ms.
--
-- The plan says why. The final filter —
--
--     where s.text_match or s.trgm_score >= 0.28 or s.country_score > 0
--
-- was pushed through both CTEs and down into the base relation, so Postgres
-- ran a sequential scan over every active property computing four `unaccent`
-- calls and four similarities per row (131 ms of the 143), and only then
-- hash-joined the result against the candidate ids. The candidate scans were
-- 10 ms and bought nothing: the expensive work happened anyway.
--
-- `as materialized` on both CTEs is the fence. The candidates are gathered
-- from the indexes, the scoring runs over those rows only, and the filter
-- applies to what comes out. Same results — the query is unchanged in every
-- other respect — in 20 ms.
--
--   lekki        143 ms -> 20 ms
--   nigeria      171 ms -> 32 ms
--   two words    170 ms -> 26 ms
--
-- The lesson worth keeping: a candidate CTE is a suggestion, not a barrier.
-- Without a fence the planner is free to re-derive the same rows the
-- expensive way, and an index that is used still leaves the scan in place.
-- ===========================================================================

select show_limit();

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
set pg_trgm.similarity_threshold = 0.27
set search_path = public
as $$
  with normalised as (
    select
      lower(unaccent(trim(search_query))) as q,
      nullif(plainto_tsquery('simple', lower(unaccent(trim(search_query))))::text, '')::tsquery
        as all_words
  ),
  matched_countries as (
    select
      c.code,
      case
        when length(n.q) >= 3
          and livd_search_text(c.name) like replace(replace(replace(n.q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
          then 1.0
        else similarity(livd_search_text(c.name), n.q)
      end as score
    from countries c, normalised n
    where (
        length(n.q) >= 3
        and livd_search_text(c.name) like replace(replace(replace(n.q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      )
      or similarity(livd_search_text(c.name), n.q) >= 0.5
  ),
  -- Materialized: see the header. Without it the planner reaches past these
  -- and scores the whole table anyway.
  candidates as materialized (
    select p.id from properties p
    where p.status = 'active' and livd_search_text(p.building_name) % (select q from normalised)
    union
    select p.id from properties p
    where p.status = 'active' and livd_search_text(p.street_address) % (select q from normalised)
    union
    select p.id from properties p
    where p.status = 'active' and livd_search_text(p.neighbourhood) % (select q from normalised)
    union
    select p.id from properties p
    where p.status = 'active' and livd_search_text(p.locality) % (select q from normalised)
    union
    select p.id from properties p
    where p.status = 'active' and p.search_vector @@ (select all_words from normalised)
    union
    select p.id from properties p
    where p.status = 'active' and p.country_code in (select code from matched_countries)
    union
    select a.property_id from property_aliases a
    where livd_search_text(a.alias) % (select q from normalised)
  ),
  scored as materialized (
    select
      p.id,
      coalesce(
        ts_rank(p.search_vector, plainto_tsquery('simple', (select q from normalised))),
        0
      ) * 4 as text_rank,
      coalesce(p.search_vector @@ (select all_words from normalised), false) as text_match,
      greatest(
        similarity(lower(unaccent(coalesce(p.building_name, ''))),  (select q from normalised)),
        similarity(lower(unaccent(coalesce(p.street_address, ''))), (select q from normalised)),
        similarity(lower(unaccent(coalesce(p.neighbourhood, ''))),  (select q from normalised)),
        similarity(lower(unaccent(p.locality)),                     (select q from normalised)),
        coalesce((
          select max(similarity(lower(unaccent(a.alias)), (select q from normalised)))
          from property_aliases a where a.property_id = p.id
        ), 0)
      ) as trgm_score,
      coalesce((select mc.score from matched_countries mc where mc.code = p.country_code), 0)
        as country_score
    from candidates c
    join properties p on p.id = c.id
    where p.status = 'active'
      and (filter_country is null or p.country_code = filter_country)
  )
  select
    s.id,
    (s.text_rank + greatest(s.trgm_score, s.country_score))::numeric as rank,
    (not s.text_match and s.country_score < 1) as is_fuzzy
  from scored s
  left join property_stats ps on ps.property_id = s.id
  where s.text_match or s.trgm_score >= 0.28 or s.country_score > 0
  order by rank desc, coalesce(ps.review_count, 0) desc
  limit result_limit
  offset result_offset;
$$;

revoke execute on function livd_property_search(text, char, int, int) from public;
grant execute on function livd_property_search(text, char, int, int) to anon, authenticated;
