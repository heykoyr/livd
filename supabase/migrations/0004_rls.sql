-- ===========================================================================
-- Livd — 0004 · Row Level Security
--
-- Default deny on every table. RLS is the authoritative authorisation layer;
-- the guards in `src/server/auth/guards.ts` are the first layer. Neither is
-- trusted alone: a forgotten guard must not become a data breach, and an
-- over-permissive policy must not become an unauthorised action.
--
-- Two rules are structural and worth stating plainly:
--
--   * No policy anywhere grants delete on `reviews`. A review is removed by
--     changing its status, so moderation stays auditable and a published
--     record cannot be made to vanish.
--   * `verification_records` has no policy at all. With RLS enabled and no
--     policy, every client role is denied — including the subject of the
--     record. It is reachable only via the service role.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function livd_current_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function livd_is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role in ('moderator', 'admin') and status = 'active'
     from profiles where id = auth.uid()),
    false
  );
$$;

create or replace function livd_is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select status = 'active' from profiles where id = auth.uid()),
    false
  );
$$;

/** True when the caller holds the approved claim on this property. */
create or replace function livd_owns_property(target_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from property_claims
    where property_id = target_property_id
      and claimant_id = auth.uid()
      and status = 'approved'
  );
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------

alter table profiles                enable row level security;
alter table properties              enable row level security;
alter table property_aliases        enable row level security;
alter table property_stats          enable row level security;
alter table reviews                 enable row level security;
alter table review_category_ratings enable row level security;
alter table review_departure_reasons enable row level security;
alter table review_tags             enable row level security;
alter table review_helpful_votes    enable row level security;
alter table review_reports          enable row level security;
alter table moderation_actions      enable row level security;
alter table verification_records    enable row level security;
alter table property_claims         enable row level security;
alter table owner_responses         enable row level security;
alter table saved_properties        enable row level security;
alter table notifications           enable row level security;
alter table search_events           enable row level security;
alter table rate_limit_events       enable row level security;

-- Reference tables: readable by everyone, writable only by the service role.
alter table countries             enable row level security;
alter table currencies            enable row level security;
alter table property_type_defs    enable row level security;
alter table property_type_labels  enable row level security;
alter table review_category_defs  enable row level security;
alter table departure_reason_defs enable row level security;
alter table review_tag_defs       enable row level security;

create policy reference_read_countries    on countries             for select using (true);
create policy reference_read_currencies   on currencies            for select using (true);
create policy reference_read_types        on property_type_defs    for select using (true);
create policy reference_read_type_labels  on property_type_labels  for select using (true);
create policy reference_read_categories   on review_category_defs  for select using (true);
create policy reference_read_departures   on departure_reason_defs for select using (true);
create policy reference_read_tags         on review_tag_defs       for select using (true);

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

-- A profile is visible only to its owner and to moderators. There is no public
-- profile in Livd, because a public profile is a way to link someone to what
-- they wrote.
create policy profiles_read_own on profiles
  for select using (id = auth.uid() or livd_is_moderator());

create policy profiles_update_own on profiles
  for update using (id = auth.uid())
  -- The role and status columns are not self-assignable; the trigger below
  -- rejects any attempt to change them.
  with check (id = auth.uid());

create policy profiles_moderator_update on profiles
  for update using (livd_is_moderator());

create or replace function livd_guard_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if livd_is_moderator() then
    return new;
  end if;

  if new.role is distinct from old.role or new.status is distinct from old.status then
    raise exception 'Role and status may only be changed by a moderator';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_self_update
  before update on profiles
  for each row execute function livd_guard_profile_self_update();

-- ---------------------------------------------------------------------------
-- Properties
-- ---------------------------------------------------------------------------

create policy properties_read_active on properties
  for select using (status = 'active' or livd_is_moderator());

create policy properties_insert_authenticated on properties
  for insert to authenticated
  with check (livd_is_active_user() and created_by = auth.uid() and status = 'active');

-- An approved claimant may correct factual details. The `livd_guard_property_update`
-- trigger restricts which columns; the policy only decides who may attempt it.
create policy properties_update_claimant on properties
  for update to authenticated
  using (livd_owns_property(id))
  with check (livd_owns_property(id));

create policy properties_update_moderator on properties
  for update using (livd_is_moderator());

create or replace function livd_guard_property_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if livd_is_moderator() then
    return new;
  end if;

  -- A claimant may describe the property. They may not change its identity,
  -- its status, or whether it is demonstration data.
  if new.status      is distinct from old.status
     or new.slug     is distinct from old.slug
     or new.is_demo  is distinct from old.is_demo
     or new.merged_into is distinct from old.merged_into
     or new.country_code is distinct from old.country_code
     or new.locality is distinct from old.locality then
    raise exception 'This column may only be changed by a moderator';
  end if;

  return new;
end;
$$;

create trigger properties_guard_update
  before update on properties
  for each row execute function livd_guard_property_update();

create policy property_aliases_read on property_aliases for select using (true);
create policy property_aliases_insert on property_aliases
  for insert to authenticated with check (livd_is_active_user());

-- Stats are public and never written by a client — only by the trigger, which
-- runs as definer.
create policy property_stats_read on property_stats for select using (true);

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------

create policy reviews_read_published on reviews
  for select using (
    status = 'published'
    or author_id = auth.uid()
    or livd_is_moderator()
  );

create policy reviews_insert_self on reviews
  for insert to authenticated
  with check (
    livd_is_active_user()
    and author_id = auth.uid()
    -- A claimant cannot review a property they own. Checked here as well as in
    -- the submit action, because this is the check that cannot be bypassed.
    and not livd_owns_property(property_id)
  );

create policy reviews_update_own on reviews
  for update to authenticated
  using (
    author_id = auth.uid()
    and status = 'published'
    and created_at > now() - interval '24 hours'
  )
  with check (author_id = auth.uid());

create policy reviews_update_moderator on reviews
  for update using (livd_is_moderator());

-- No delete policy exists on `reviews`, by design.

/*
 * Restricts what an author may change within their edit window.
 *
 * Corrections are for typos and clarity. Rewriting the ratings after the fact
 * would let someone launder a review's meaning while keeping its timestamp and
 * its verification status.
 */
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

create trigger reviews_guard_update
  before update on reviews
  for each row execute function livd_guard_review_update();

-- Child tables inherit their parent review's visibility.
create policy review_categories_read on review_category_ratings
  for select using (
    exists (select 1 from reviews r where r.id = review_id
            and (r.status = 'published' or r.author_id = auth.uid() or livd_is_moderator()))
  );

create policy review_categories_insert on review_category_ratings
  for insert to authenticated
  with check (exists (select 1 from reviews r where r.id = review_id and r.author_id = auth.uid()));

create policy review_departures_read on review_departure_reasons
  for select using (
    exists (select 1 from reviews r where r.id = review_id
            and (r.status = 'published' or r.author_id = auth.uid() or livd_is_moderator()))
  );

create policy review_departures_insert on review_departure_reasons
  for insert to authenticated
  with check (exists (select 1 from reviews r where r.id = review_id and r.author_id = auth.uid()));

create policy review_tags_read on review_tags
  for select using (
    exists (select 1 from reviews r where r.id = review_id
            and (r.status = 'published' or r.author_id = auth.uid() or livd_is_moderator()))
  );

create policy review_tags_insert on review_tags
  for insert to authenticated
  with check (exists (select 1 from reviews r where r.id = review_id and r.author_id = auth.uid()));

-- Votes are private to the voter; only the aggregate count is public.
create policy helpful_votes_read_own on review_helpful_votes
  for select using (voter_id = auth.uid());

create policy helpful_votes_insert on review_helpful_votes
  for insert to authenticated
  with check (livd_is_active_user() and voter_id = auth.uid());

create policy helpful_votes_delete_own on review_helpful_votes
  for delete using (voter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Reports and moderation
-- ---------------------------------------------------------------------------

create policy reports_read on review_reports
  for select using (reporter_id = auth.uid() or livd_is_moderator());

create policy reports_insert on review_reports
  for insert to authenticated
  with check (livd_is_active_user() and reporter_id = auth.uid());

create policy reports_update_moderator on review_reports
  for update using (livd_is_moderator());

-- Append-only: insert for moderators, read for moderators, nothing else.
create policy moderation_read on moderation_actions
  for select using (livd_is_moderator());

create policy moderation_insert on moderation_actions
  for insert to authenticated
  with check (livd_is_moderator() and actor_id = auth.uid());

-- `verification_records` intentionally has RLS enabled and no policy, which
-- denies every client role including the record's own subject.

-- Rate limit events are written and read only by the service role.

-- ---------------------------------------------------------------------------
-- Claims and owner responses
-- ---------------------------------------------------------------------------

create policy claims_read on property_claims
  for select using (claimant_id = auth.uid() or livd_is_moderator());

create policy claims_insert on property_claims
  for insert to authenticated
  with check (livd_is_active_user() and claimant_id = auth.uid() and status = 'pending');

create policy claims_update_moderator on property_claims
  for update using (livd_is_moderator());

create policy owner_responses_read on owner_responses
  for select using (status = 'published' or livd_is_moderator() or responder_id = auth.uid());

-- Only the approved claimant of the property may respond, and only as themselves.
create policy owner_responses_insert on owner_responses
  for insert to authenticated
  with check (
    livd_is_active_user()
    and responder_id = auth.uid()
    and livd_owns_property(property_id)
    and exists (
      select 1 from reviews r
      where r.id = review_id and r.property_id = owner_responses.property_id
    )
  );

create policy owner_responses_update_moderator on owner_responses
  for update using (livd_is_moderator());

-- ---------------------------------------------------------------------------
-- Personalisation
-- ---------------------------------------------------------------------------

create policy saved_read_own   on saved_properties for select using (user_id = auth.uid());
create policy saved_insert_own on saved_properties for insert to authenticated
  with check (user_id = auth.uid());
create policy saved_update_own on saved_properties for update using (user_id = auth.uid());
create policy saved_delete_own on saved_properties for delete using (user_id = auth.uid());

create policy notifications_read_own   on notifications for select using (user_id = auth.uid());
create policy notifications_update_own on notifications for update using (user_id = auth.uid());

-- Search events are write-only from the client's perspective: anyone may record
-- one, nobody may read them back. There is no user_id to correlate anyway.
create policy search_events_insert on search_events for insert with check (true);
