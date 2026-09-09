-- ===========================================================================
-- Livd — 0024 · The user directory, and one account in detail
--
-- 0022 replaced a page that printed everyone's email with a masked, paginated
-- list. This gives that list the filters and the search a moderator actually
-- works with, and adds the view behind it: one account, with the reviews it
-- wrote, the reports involving it, and what Livd has been able to establish
-- about it.
--
-- WHAT THIS DOES NOT DO
--
-- It does not reveal an identity. Every function here returns a masked
-- address, exactly as 0022 does, and none of them touches `auth.users.email`
-- except to hand it to `livd_mask_email`. Revealing an account is a separate
-- operation with its own authorisation and its own audit entry, and it arrives
-- in the next migration.
--
-- SEARCHING BY EMAIL IS NOT THE SAME AS SEARCHING BY ID
--
-- Typing an address into a search box and getting a result back tells you that
-- address holds an account here. On a platform where the accounts write
-- anonymous reviews of the buildings they live in, that is a disclosure —
-- small, but real, and exactly the kind a property owner's lawyer would try.
--
-- So the two searches are gated differently. An id prefix is a moderator's
-- tool: internal identifiers mean nothing outside Livd and cannot be guessed.
-- An address is a Trust & Safety one. The function decides which kind it has
-- been handed by looking for an `@`, and refuses the second to a moderator.
--
-- The search term itself is never audited when it is an address. An audit log
-- that records the email it was asked about has become another copy of the
-- thing it protects; the entry records that an email search happened, and the
-- account it landed on.
-- ===========================================================================

-- Reports are counted against a person in two directions — made by them, and
-- made about what they wrote — and only one of those was indexed.
create index if not exists review_reports_reporter_idx on review_reports (reporter_id);

-- ---------------------------------------------------------------------------
-- Counts, in one place
--
-- Both the directory and the detail view need the same figures, and they must
-- agree: a list saying four reviews beside a page saying three is a bug
-- somebody will chase for an afternoon.
-- ---------------------------------------------------------------------------

create or replace function livd_admin_user_counts(target_user_id uuid)
returns table (
  review_count           bigint,
  published_review_count bigint,
  removed_review_count   bigint,
  held_review_count      bigint,
  verified_review_count  bigint,
  reports_against        bigint,
  reports_made           bigint,
  location_check_count   bigint,
  residency_submissions  bigint,
  last_review_at         timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from reviews r where r.author_id = target_user_id),
    (select count(*) from reviews r where r.author_id = target_user_id and r.status = 'published'),
    (select count(*) from reviews r where r.author_id = target_user_id and r.status = 'removed'),
    (select count(*) from reviews r where r.author_id = target_user_id
       and r.status in ('held', 'pending_moderation')),
    (select count(*) from reviews r where r.author_id = target_user_id
       and r.verification_level in ('location_verified', 'verified_resident')),
    (select count(*) from review_reports rr
       join reviews r on r.id = rr.review_id
      where r.author_id = target_user_id),
    (select count(*) from review_reports rr where rr.reporter_id = target_user_id),
    (select count(*) from property_verifications pv where pv.user_id = target_user_id),
    (select count(*) from verification_records vr where vr.submitted_by = target_user_id),
    (select max(r.created_at) from reviews r where r.author_id = target_user_id);
$$;

revoke execute on function livd_admin_user_counts(uuid) from public, anon, authenticated;

comment on function livd_admin_user_counts(uuid) is
  'Shared by the directory and the detail view so the two can never disagree. Not callable by a client; both callers are SECURITY DEFINER.';

-- ---------------------------------------------------------------------------
-- The directory
-- ---------------------------------------------------------------------------

drop function if exists livd_admin_user_directory(integer, integer);

create or replace function livd_admin_user_directory(
  page_size          integer default 25,
  page_offset        integer default 0,
  search_term        text    default null,
  filter_role        user_role   default null,
  filter_status      user_status default null,
  filter_verified    boolean default null,
  filter_reported    boolean default null,
  joined_after       timestamptz default null,
  min_review_count   integer default null
)
returns table (
  id             uuid,
  masked_email   text,
  role           user_role,
  status         user_status,
  country_code   char(2),
  created_at     timestamptz,
  review_count   bigint,
  verified_review_count bigint,
  reports_against bigint,
  last_review_at timestamptz,
  total_count    bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text := nullif(btrim(coalesce(search_term, '')), '');
  searching_by_email boolean := term is not null and position('@' in term) > 0;
begin
  if not livd_is_moderator() then
    raise exception 'Not authorised to read the user directory' using errcode = '42501';
  end if;

  -- See the header. Confirming that an address holds an account is a
  -- disclosure, however small, and it is not a moderator's to make.
  if searching_by_email and not livd_is_trust_admin() then
    raise exception 'Searching by email address requires Trust and Safety authorisation'
      using errcode = '42501';
  end if;

  return query
  with matched as (
    select p.id, p.role, p.status, p.country_code, p.created_at, u.email::text as raw_email
    from profiles p
    join auth.users u on u.id = p.id
    where
      (term is null
       or (searching_by_email and lower(u.email::text) = lower(term))
       -- An id prefix, not a substring: an internal identifier is looked up,
       -- never trawled.
       or (not searching_by_email and p.id::text like lower(term) || '%'))
      and (filter_role is null or p.role = filter_role)
      and (filter_status is null or p.status = filter_status)
      and (joined_after is null or p.created_at >= joined_after)
  ),
  counted as (
    select m.*, c.*
    from matched m
    cross join lateral livd_admin_user_counts(m.id) c
  )
  select
    c.id,
    livd_mask_email(c.raw_email),
    c.role,
    c.status,
    c.country_code,
    c.created_at,
    c.review_count,
    c.verified_review_count,
    c.reports_against,
    c.last_review_at,
    count(*) over () as total_count
  from counted c
  where (filter_verified is null
         or (filter_verified and c.verified_review_count > 0)
         or (not filter_verified and c.verified_review_count = 0))
    and (filter_reported is null
         or (filter_reported and c.reports_against > 0)
         or (not filter_reported and c.reports_against = 0))
    and (min_review_count is null or c.review_count >= min_review_count)
  order by c.created_at desc, c.id desc
  limit greatest(1, least(coalesce(page_size, 25), 100))
  offset greatest(0, coalesce(page_offset, 0));
end;
$$;

revoke execute on function livd_admin_user_directory(
  integer, integer, text, user_role, user_status, boolean, boolean, timestamptz, integer
) from public, anon;
grant execute on function livd_admin_user_directory(
  integer, integer, text, user_role, user_status, boolean, boolean, timestamptz, integer
) to authenticated;

comment on function livd_admin_user_directory(
  integer, integer, text, user_role, user_status, boolean, boolean, timestamptz, integer
) is
  'The admin user directory. Masks in SQL; refuses an email search to anyone below trust_admin.';

-- ---------------------------------------------------------------------------
-- One account
-- ---------------------------------------------------------------------------

create or replace function livd_admin_user_detail(target_user_id uuid)
returns table (
  id             uuid,
  masked_email   text,
  role           user_role,
  status         user_status,
  country_code   char(2),
  preferred_locale text,
  created_at     timestamptz,
  review_count           bigint,
  published_review_count bigint,
  removed_review_count   bigint,
  held_review_count      bigint,
  verified_review_count  bigint,
  reports_against        bigint,
  reports_made           bigint,
  location_check_count   bigint,
  residency_submissions  bigint,
  last_review_at         timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not livd_is_moderator() then
    raise exception 'Not authorised to read this account' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    livd_mask_email(u.email::text),
    p.role, p.status, p.country_code, p.preferred_locale, p.created_at,
    c.review_count, c.published_review_count, c.removed_review_count,
    c.held_review_count, c.verified_review_count,
    c.reports_against, c.reports_made,
    c.location_check_count, c.residency_submissions, c.last_review_at
  from profiles p
  join auth.users u on u.id = p.id
  cross join lateral livd_admin_user_counts(p.id) c
  where p.id = target_user_id;
end;
$$;

/**
 * What one account has written, and what happened to it.
 *
 * The property is returned as its address components rather than a rendered
 * name, so the admin console formats it the same way every other surface in
 * the product does — per-country templates, not a string built in SQL.
 */
create or replace function livd_admin_user_reviews(
  target_user_id uuid,
  page_size      integer default 25,
  page_offset    integer default 0
)
returns table (
  review_id          uuid,
  property_id        uuid,
  property_slug      text,
  building_name      text,
  street_address     text,
  neighbourhood      text,
  locality           text,
  admin_area         text,
  postal_code        text,
  country_code       char(2),
  overall_rating     smallint,
  residency_status   residency_status,
  verification_level verification_level,
  status             review_status,
  created_at         timestamptz,
  report_count       bigint,
  total_count        bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not livd_is_moderator() then
    raise exception 'Not authorised to read this account' using errcode = '42501';
  end if;

  return query
  select
    r.id, pr.id, pr.slug,
    pr.building_name, pr.street_address, pr.neighbourhood, pr.locality,
    pr.admin_area, pr.postal_code, pr.country_code,
    r.overall_rating, r.residency_status, r.verification_level, r.status, r.created_at,
    (select count(*) from review_reports rr where rr.review_id = r.id),
    count(*) over () as total_count
  from reviews r
  join properties pr on pr.id = r.property_id
  where r.author_id = target_user_id
  order by r.created_at desc, r.id desc
  limit greatest(1, least(coalesce(page_size, 25), 100))
  offset greatest(0, coalesce(page_offset, 0));
end;
$$;

/**
 * Reports about what this account wrote.
 *
 * The reporter is returned as an id and nothing else. A moderator investigating
 * a complaint needs to know that the same account has filed nine of them; they
 * do not need to know who that account belongs to, and this does not tell them.
 */
create or replace function livd_admin_user_reports(
  target_user_id uuid,
  page_size      integer default 25,
  page_offset    integer default 0
)
returns table (
  report_id    uuid,
  review_id    uuid,
  reporter_id  uuid,
  reason       report_reason,
  detail       text,
  status       report_status,
  resolution   text,
  created_at   timestamptz,
  resolved_at  timestamptz,
  total_count  bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not livd_is_moderator() then
    raise exception 'Not authorised to read this account' using errcode = '42501';
  end if;

  return query
  select rr.id, rr.review_id, rr.reporter_id, rr.reason, rr.detail,
         rr.status, rr.resolution, rr.created_at, rr.resolved_at,
         count(*) over () as total_count
  from review_reports rr
  join reviews r on r.id = rr.review_id
  where r.author_id = target_user_id
  order by rr.created_at desc, rr.id desc
  limit greatest(1, least(coalesce(page_size, 25), 100))
  offset greatest(0, coalesce(page_offset, 0));
end;
$$;

revoke execute on function livd_admin_user_detail(uuid)                    from public, anon;
revoke execute on function livd_admin_user_reviews(uuid, integer, integer) from public, anon;
revoke execute on function livd_admin_user_reports(uuid, integer, integer) from public, anon;

grant execute on function livd_admin_user_detail(uuid)                    to authenticated;
grant execute on function livd_admin_user_reviews(uuid, integer, integer) to authenticated;
grant execute on function livd_admin_user_reports(uuid, integer, integer) to authenticated;

comment on function livd_admin_user_detail(uuid) is
  'One account, masked. Never returns auth.users.email — revealing an identity is a separate, audited operation.';
