-- ===========================================================================
-- Livd — 0054 · Search at scale: indexed candidates, honest matching, countries
--
-- Three things, found by running the expanded sample dataset through search.
--
-- 1. IT READ EVERY PROPERTY, EVERY TIME
--
-- `livd_property_search` (0003) scored every active property on every call —
-- five `unaccent` calls, four trigram similarities and a correlated alias
-- lookup per row — and only then filtered. A sequential scan whose cost grows
-- with the table, called by the typeahead as somebody types.
--
-- Candidates now come from a union of index-backed scans, one per way a
-- property can match, and the 0003 scoring runs over those alone. A union
-- rather than one OR: an `exists` on aliases or an `in` on countries inside a
-- single OR makes the planner check every row, which is the thing being
-- avoided.
--
-- 2. `ts_rank > 0` WAS NOT A MATCH TEST
--
-- `ts_rank` returns a tiny positive number for a row that does not satisfy a
-- multi-word query, so `text_rank > 0` admitted **every property in the
-- database** for any query of two words or more. "Port Harcourt" returned all
-- 1,842 seeded properties — the right ones first, then everything else,
-- padding every page after the first and making the result count meaningless.
-- A full-text match is now `search_vector @@ plainto_tsquery(...)`: all the
-- words, which is what `ts_rank > 0` already meant for a single word. Single
-- word queries are unaffected, to the row and to the digit; the checks are in
-- the file this migration was verified against.
--
-- 3. A COUNTRY'S NAME MATCHED NOTHING
--
-- Searching "Nigeria" found nothing, because no field it looked at holds a
-- country's name. With a thousand Nigerian properties that reads as an empty
-- product. A country matches when the query is its name, a prefix of three
-- letters or more, or close to it (similarity 0.5 — a misspelling, not a
-- neighbourhood sharing letters: "Indiranagar" must not return all of India).
--
-- `livd_search_text` exists so the trigram indexes can be built at all.
-- `unaccent(text)` is only STABLE, because its dictionary can change, and an
-- index needs an IMMUTABLE expression. Naming the dictionary is the standard
-- way to make that promise; it is the dictionary the one-argument form uses,
-- so the folded text is identical.
-- ===========================================================================

-- Loads pg_trgm into this session, so `pg_trgm.similarity_threshold` is a real
-- setting rather than a placeholder when the function below is created. A
-- placeholder there is refused: "permission denied to set parameter".
select show_limit();

create or replace function livd_search_text(value text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select lower(public.unaccent('public.unaccent'::regdictionary, coalesce(value, '')));
$$;

comment on function livd_search_text(text) is
  'lower(unaccent(value)) with the dictionary named, so it can be indexed. Used by livd_property_search.';

create index if not exists properties_search_name_trgm_idx
  on properties using gin (livd_search_text(building_name) gin_trgm_ops) where status = 'active';
create index if not exists properties_search_street_trgm_idx
  on properties using gin (livd_search_text(street_address) gin_trgm_ops) where status = 'active';
create index if not exists properties_search_neighbourhood_trgm_idx
  on properties using gin (livd_search_text(neighbourhood) gin_trgm_ops) where status = 'active';
create index if not exists properties_search_locality_trgm_idx
  on properties using gin (livd_search_text(locality) gin_trgm_ops) where status = 'active';
create index if not exists property_aliases_search_trgm_idx
  on property_aliases using gin (livd_search_text(alias) gin_trgm_ops);

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
-- Read by the candidate filter's `%`. The final filter still applies 0.28.
set pg_trgm.similarity_threshold = 0.27
set search_path = public
as $$
  with normalised as (
    select
      lower(unaccent(trim(search_query))) as q,
      -- Every word of the query, as a full-text match requires. Null when the
      -- query has no words at all, rather than an empty query that matches
      -- nothing with a notice.
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
  candidates as (
    -- A union of index scans, one per way a property can match. As a single
    -- OR the per-row alias and country checks forced a scan of every row;
    -- as separate branches each one is answered by its own index.
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
  scored as (
    -- The 0003 scoring, over the candidates only.
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
    from properties p
    join candidates c on c.id = p.id
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

-- Grants as before: the application calls it as an RPC. SECURITY INVOKER, so
-- RLS still applies to everything it reads.
revoke execute on function livd_property_search(text, char, int, int) from public;
grant execute on function livd_property_search(text, char, int, int) to anon, authenticated;
revoke execute on function livd_search_text(text) from public;
grant execute on function livd_search_text(text) to anon, authenticated;
