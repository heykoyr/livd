-- ===========================================================================
-- Livd — 0022 · The admin user directory
--
-- THE PROBLEM
--
-- `/admin/users` rendered every account's real email address. The adapter
-- fetched them with the service-role key through `auth.admin.listUsers()` and
-- the page printed them, so anyone admitted by the layout guard — which admits
-- moderators — read the address of all 124 accounts. Nothing was recorded, and
-- nothing needed to be, because it was not modelled as an act at all.
--
-- On a platform whose entire promise is that a reviewer stays anonymous, an
-- unlogged bulk list of who everyone is was the single largest privacy hole in
-- the product.
--
-- It also fetched them wrongly. `listUsers({ perPage: limit })` returns the
-- first page of accounts in Auth's own order, which is not the order of the
-- profile page it was zipped against, so past the first page the emails did not
-- even belong to the rows they were shown beside.
--
-- THE FIX
--
-- The directory is computed in Postgres and the mask is applied there, so the
-- raw address is never selected into anything the application holds. There is
-- no object in server memory carrying it, so there is none to leak into a
-- payload, a log line or an error message by accident.
--
-- This is data minimisation at the only place it is structural. A mask applied
-- in TypeScript is a promise; a mask applied before the value crosses the
-- boundary is a property.
--
-- Revealing an actual address is a separate, audited operation, and it does not
-- exist yet — it arrives with the identity-access log in a later phase. Until
-- then nothing in this application can read an account's email but the account
-- itself.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The mask
--
--   feranmiadekoya@gmail.com  ->  fer***@gmail.com
--
-- At most the first three characters, and never more than half the local part,
-- so a short address does not get revealed in full by a rule tuned for a long
-- one: `ab@x.com` masks to `a***@x.com`, not to itself.
--
-- The domain is kept. It carries no identity on its own and a moderator
-- triaging a wave of throwaway signups needs to see that they share one.
-- ---------------------------------------------------------------------------

create or replace function livd_mask_email(email text)
returns text
language sql
immutable
as $$
  select case
    when email is null or position('@' in email) < 2 then '—'
    else
      left(
        split_part(email, '@', 1),
        least(3, greatest(0, char_length(split_part(email, '@', 1)) / 2))
      )
      || '***@'
      || split_part(email, '@', 2)
  end;
$$;

comment on function livd_mask_email(text) is
  'Masks a local part to at most three leading characters, never more than half of it. Keeps the domain.';

-- ---------------------------------------------------------------------------
-- The directory
--
-- Joins `profiles` to `auth.users` — which no client role can reach — and
-- returns the masked address alongside the standing that decides what a
-- moderator does next. `total_count` rides along on every row so the page can
-- paginate without a second round trip.
--
-- SECURITY DEFINER with the moderator check inside it. The function is the
-- authorisation boundary: `auth.users` is not exposed through PostgREST at all,
-- so this is the only path to an email in the database, and it does not return
-- one.
-- ---------------------------------------------------------------------------

create or replace function livd_admin_user_directory(
  page_size   integer default 25,
  page_offset integer default 0
)
returns table (
  id           uuid,
  masked_email text,
  role         user_role,
  status       user_status,
  country_code char(2),
  created_at   timestamptz,
  total_count  bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not livd_is_moderator() then
    raise exception 'Not authorised to read the user directory' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    livd_mask_email(u.email::text),
    p.role,
    p.status,
    p.country_code,
    p.created_at,
    count(*) over () as total_count
  from profiles p
  join auth.users u on u.id = p.id
  -- Ordered by id as well as time: two accounts created in the same
  -- microsecond would otherwise be free to swap places between pages, and a
  -- row that moves during paging is a row somebody never sees.
  order by p.created_at desc, p.id desc
  limit greatest(1, least(coalesce(page_size, 25), 100))
  offset greatest(0, coalesce(page_offset, 0));
end;
$$;

/**
 * Resolves an address a caller already holds to an account id.
 *
 * For "somebody wrote in about this address" — the one lookup where an email is
 * the only handle available. It discloses nothing new: the caller supplied the
 * address, and gets back an internal identifier, never the other direction.
 *
 * Replaces an adapter method that pulled the entire Auth user list and searched
 * the first page of it, which silently returned "no such account" for anyone
 * past the fiftieth. It was wrong at the deployment's current size.
 */
create or replace function livd_admin_find_user_by_email(lookup_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  found uuid;
begin
  if not livd_is_moderator() then
    raise exception 'Not authorised to look up an account' using errcode = '42501';
  end if;

  select p.id into found
  from profiles p
  join auth.users u on u.id = p.id
  where lower(u.email::text) = lower(btrim(lookup_email))
  limit 1;

  return found;
end;
$$;

revoke execute on function livd_admin_user_directory(integer, integer)  from public, anon;
revoke execute on function livd_admin_find_user_by_email(text)          from public, anon;
revoke execute on function livd_mask_email(text)                        from public, anon, authenticated;

grant execute on function livd_admin_user_directory(integer, integer) to authenticated;
grant execute on function livd_admin_find_user_by_email(text)         to authenticated;

comment on function livd_admin_user_directory(integer, integer) is
  'The admin user directory. Masks in SQL so no raw address is ever selected into the application.';
comment on function livd_admin_find_user_by_email(text) is
  'Email to account id, for a caller who already holds the address. Never the reverse.';
