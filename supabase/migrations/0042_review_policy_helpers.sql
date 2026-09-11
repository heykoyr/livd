-- ===========================================================================
-- Livd — 0042 · Making 0040 survivable
--
-- 0040 removed the table-level SELECT grant on `reviews` so that `author_id`
-- could be withheld at column level. Seven policies on the review side-tables
-- immediately stopped working, and the first one tried took the whole property
-- page with it:
--
--     select count(*) from review_category_ratings;
--     ERROR: permission denied for table reviews
--
-- WHY
--
-- Those policies are written as sub-selects:
--
--     exists (select 1 from reviews r
--             where r.id = review_tags.review_id
--               and (r.status = 'published' or r.author_id = auth.uid()
--                    or livd_is_moderator()))
--
-- A policy expression is evaluated with the *querying* role's privileges. The
-- sub-select therefore needs that role to hold SELECT on `reviews` — the whole
-- table, and on `author_id` in particular, both of which 0040 had just taken
-- away.
--
-- This is the same trap as 0021, which revoked EXECUTE on the policy predicate
-- functions and made `profiles` unreadable. The lesson was supposed to be
-- learnt. It was not, and what caught it this time was running the public read
-- path as `anon` immediately after the change rather than assuming the pages
-- were fine because the tests passed — the suite uses the local adapter, which
-- has no privilege system at all and could not have noticed.
--
-- THE FIX
--
-- The same shape as `livd_is_moderator()`: move the condition into a
-- SECURITY DEFINER function, which reads `reviews` with the owner's rights,
-- and grant EXECUTE on it to the client roles so a policy may call it.
--
-- Two helpers, because the seven policies ask two different questions, plus a
-- third for the owner-response rule. Each replaces a sub-select the caller is
-- no longer allowed to run, and none of them returns anything about the author
-- — they answer yes or no.
-- ===========================================================================

/**
 * Whether the caller may see this review at all.
 *
 * Mirrors `reviews_read_published` exactly: published, or theirs, or they
 * moderate. Anything else would let a side-table disagree with the row it
 * belongs to.
 */
create or replace function livd_review_is_readable(target_review uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from reviews r
    where r.id = target_review
      and (r.status = 'published' or r.author_id = auth.uid() or livd_is_moderator())
  );
$fn$;

/** Whether the caller wrote it. Used by the insert policies. */
create or replace function livd_review_is_mine(target_review uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from reviews r where r.id = target_review and r.author_id = auth.uid()
  );
$fn$;

/** Whether a review belongs to a property. For the owner-response rule. */
create or replace function livd_review_on_property(target_review uuid, target_property uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from reviews r where r.id = target_review and r.property_id = target_property
  );
$fn$;

-- Granted to everybody, deliberately. A policy expression runs with the
-- querying role's privileges, so a role that cannot execute the predicate
-- cannot read the table the policy protects — which is the failure 0021
-- documented, in the other direction. These answer a boolean about the caller
-- and reveal nothing to somebody who calls them directly.
grant execute on function livd_review_is_readable(uuid) to anon, authenticated;
grant execute on function livd_review_is_mine(uuid) to anon, authenticated;
grant execute on function livd_review_on_property(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The policies, rewritten
-- ---------------------------------------------------------------------------

drop policy if exists review_categories_read   on review_category_ratings;
drop policy if exists review_categories_insert on review_category_ratings;

create policy review_categories_read on review_category_ratings
  for select using (livd_review_is_readable(review_id));

create policy review_categories_insert on review_category_ratings
  for insert with check (livd_review_is_mine(review_id));

drop policy if exists review_tags_read   on review_tags;
drop policy if exists review_tags_insert on review_tags;

create policy review_tags_read on review_tags
  for select using (livd_review_is_readable(review_id));

create policy review_tags_insert on review_tags
  for insert with check (livd_review_is_mine(review_id));

drop policy if exists review_departures_read   on review_departure_reasons;
drop policy if exists review_departures_insert on review_departure_reasons;

create policy review_departures_read on review_departure_reasons
  for select using (livd_review_is_readable(review_id));

create policy review_departures_insert on review_departure_reasons
  for insert with check (livd_review_is_mine(review_id));

drop policy if exists owner_responses_insert on owner_responses;

create policy owner_responses_insert on owner_responses
  for insert with check (
    livd_is_active_user()
    and responder_id = auth.uid()
    and livd_owns_property(property_id)
    and livd_review_on_property(review_id, property_id)
  );
