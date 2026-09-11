-- ===========================================================================
-- Livd — 0047 · The ratings become correctable too
--
-- 0004 froze `overall_rating` for the author's edit window and said why:
--
--     Corrections are for typos and clarity. Rewriting the ratings after the
--     fact would let someone launder a review's meaning while keeping its
--     timestamp and its verification status.
--
-- That reasoning was written when nothing could correct a review at all, and
-- it is answering a question about *unbounded* rewriting. The product decision
-- here is that a rating is part of what a person said, and a review flow that
-- lets somebody fix the sentence but not the number they now think was wrong is
-- offering half a correction. A reviewer who chose 2 in a bad week and means 3
-- has a mistake to fix, not a meaning to launder.
--
-- So the ratings join the body and the recommendation. What keeps the original
-- objection answered is everything that was already built around them:
--
--   * The window. Twenty-four hours from `created_at`, and 0046 made
--     `created_at` immutable — so this is bounded and cannot be extended.
--   * The snapshot. `livd_snapshot_review` has fired on `overall_rating` since
--     0030 and copies the category ratings as jsonb with it, so the score a
--     review was published with is preserved before any change, with
--     `changed_by` naming who changed it. Nothing is overwritten without a
--     record.
--   * The aggregates. `reviews_refresh_stats` and
--     `review_category_ratings_refresh_stats` both fire on UPDATE, so a
--     property's score, confidence and effective sample size recompute inside
--     the same transaction. A corrected rating that left a stale score behind
--     would be the actual laundering risk, and it cannot happen.
--
-- WHAT DOES NOT CHANGE
--
-- The tenancy, the property, the verification level and the rent stay frozen.
-- Those are not opinions somebody can revise — they are claims about what
-- happened, and the badge in particular is the thing a rating change would ride
-- on if it could be moved.
--
-- CATEGORY RATINGS GO THROUGH THE FUNCTION, NOT THROUGH PostgREST
--
-- `review_category_ratings` has an insert policy for the author and no update
-- or delete policy at all, which is why they were unreachable. Rather than add
-- two policies and a second way in, `livd_correct_review` replaces the set
-- inside its own transaction. One path, one set of checks, and the delete and
-- the insert cannot be separated by a caller who stops halfway — which would
-- leave a review with no category ratings and a silently different score.
--
-- `overall_rating` does move to the guard's allow-list, because a bare
-- `PATCH { overall_rating }` is already fenced by `reviews_update_own` to the
-- author, a published review and the window, exactly as `body` is.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The guard, with the rating on the other side of the line
-- ---------------------------------------------------------------------------

create or replace function livd_guard_review_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- Everything a non-moderator may never move. `body`, `would_recommend`,
  -- `overall_rating` and `updated_at` are absent, and they are the whole of
  -- what an author may change.
  frozen boolean := (
        new.id                        is distinct from old.id
     or new.property_id               is distinct from old.property_id
     or new.author_id                 is distinct from old.author_id
     or new.residency_status          is distinct from old.residency_status
     or new.moved_in_month            is distinct from old.moved_in_month
     or new.moved_out_month           is distinct from old.moved_out_month
     or new.tenure_months             is distinct from old.tenure_months
     or new.rent_amount_minor         is distinct from old.rent_amount_minor
     or new.rent_currency             is distinct from old.rent_currency
     or new.rent_period               is distinct from old.rent_period
     or new.noticed_management_change is distinct from old.noticed_management_change
     or new.verification_level        is distinct from old.verification_level
     or new.verification_id           is distinct from old.verification_id
     or new.verified_at               is distinct from old.verified_at
     or new.status                    is distinct from old.status
     or new.safety_flags              is distinct from old.safety_flags
     or new.helpful_count             is distinct from old.helpful_count
     or new.is_demo                   is distinct from old.is_demo
     or new.created_at                is distinct from old.created_at
  );
begin
  if livd_is_moderator() then
    return new;
  end if;

  if not frozen then
    return new;
  end if;

  -- The account-deletion path, unchanged from 0018: a foreign key severing
  -- this review from an author who no longer exists. Permitted only when it is
  -- the sole change.
  if old.author_id is not null
     and new.author_id is null
     and new.body                      is not distinct from old.body
     and new.would_recommend           is not distinct from old.would_recommend
     and new.overall_rating            is not distinct from old.overall_rating
     and new.id                        is not distinct from old.id
     and new.property_id               is not distinct from old.property_id
     and new.residency_status          is not distinct from old.residency_status
     and new.moved_in_month            is not distinct from old.moved_in_month
     and new.moved_out_month           is not distinct from old.moved_out_month
     and new.tenure_months             is not distinct from old.tenure_months
     and new.rent_amount_minor         is not distinct from old.rent_amount_minor
     and new.rent_currency             is not distinct from old.rent_currency
     and new.rent_period               is not distinct from old.rent_period
     and new.noticed_management_change is not distinct from old.noticed_management_change
     and new.verification_level        is not distinct from old.verification_level
     and new.verification_id           is not distinct from old.verification_id
     and new.verified_at               is not distinct from old.verified_at
     and new.status                    is not distinct from old.status
     and new.safety_flags              is not distinct from old.safety_flags
     and new.helpful_count             is not distinct from old.helpful_count
     and new.is_demo                   is not distinct from old.is_demo
     and new.created_at                is not distinct from old.created_at then
    return new;
  end if;

  -- The correction path. Set only by `livd_correct_review`, and additionally
  -- required to satisfy everything `reviews_update_own` requires, so the
  -- setting on its own grants nothing.
  if coalesce(current_setting('livd.correction', true), '') = 'on'
     and new.author_id  = auth.uid()
     and old.author_id  = auth.uid()
     and old.status     = 'published'
     and old.created_at > now() - interval '24 hours'
     -- One direction only: a review may leave the property page for a
     -- moderator to read, and may not put itself back.
     and (new.status = old.status or new.status = 'pending_moderation')
     -- Flags grow or stay. `<@` is "contained by", so every flag the linter
     -- raised before is still there.
     and old.safety_flags <@ new.safety_flags
     -- Everything else is still.
     and new.id                        is not distinct from old.id
     and new.property_id               is not distinct from old.property_id
     and new.residency_status          is not distinct from old.residency_status
     and new.moved_in_month            is not distinct from old.moved_in_month
     and new.moved_out_month           is not distinct from old.moved_out_month
     and new.tenure_months             is not distinct from old.tenure_months
     and new.rent_amount_minor         is not distinct from old.rent_amount_minor
     and new.rent_currency             is not distinct from old.rent_currency
     and new.rent_period               is not distinct from old.rent_period
     and new.noticed_management_change is not distinct from old.noticed_management_change
     and new.verification_level        is not distinct from old.verification_level
     and new.verification_id           is not distinct from old.verification_id
     and new.verified_at               is not distinct from old.verified_at
     and new.helpful_count             is not distinct from old.helpful_count
     and new.is_demo                   is not distinct from old.is_demo
     and new.created_at                is not distinct from old.created_at then
    return new;
  end if;

  raise exception 'Only the written review, its ratings and the recommendation may be corrected'
    using errcode = '42501';
end;
$fn$;

comment on function livd_guard_review_update() is
  'What an author may change inside their edit window, as an allow-list: the body, the ratings and the recommendation, and nothing else. Permits two narrow system transitions — a foreign key nulling author_id on account deletion, and livd_correct_review holding a corrected review for a moderator. A column added to reviews later is immutable until this function says otherwise.';

-- ---------------------------------------------------------------------------
-- The correction, now carrying the ratings
--
-- `new_categories` is a jsonb array of `{"categoryKey": text, "rating": int}`,
-- the same shape `review_snapshots.category_ratings` already stores and the
-- same shape the client sends on submission. Null leaves the existing set
-- alone; an array replaces it wholesale.
--
-- Replaced rather than merged, because the reviewer's screen is the whole set:
-- a category they cleared is a category they no longer wish to rate, and a
-- merge has no way to express that. The delete and the insert are one
-- statement block, so the two triggers that recompute `property_stats` see a
-- complete set on either side and never an empty one.
-- ---------------------------------------------------------------------------

create or replace function livd_correct_review(
  target_review  uuid,
  new_body       text,
  new_recommend  boolean,
  add_flags      text[] default '{}',
  hold           boolean default false,
  new_overall    smallint default null,
  new_categories jsonb default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $fn$
declare
  actor    uuid := auth.uid();
  actor_r  user_role;
  r        reviews%rowtype;
  deadline timestamptz;
  merged   text[];
  keep     smallint;
begin
  if actor is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  -- Locked, so a correction and a moderator's decision on the same review
  -- cannot interleave and leave the snapshot describing neither.
  select * into r from reviews where id = target_review for update;

  -- Not found and not yours are the same refusal on purpose. A distinguishable
  -- "no such review" turns this function into a way to enumerate review ids.
  if r.id is null or r.author_id is distinct from actor then
    raise exception 'You do not have permission to edit this review'
      using errcode = '42501';
  end if;

  if r.status <> 'published' then
    raise exception 'Only a published review can be corrected' using errcode = '42501';
  end if;

  deadline := r.created_at + interval '24 hours';

  -- `now()` is the transaction's clock, read here and never from the caller.
  -- A stale page, a slow network or a client with a wrong system time all
  -- arrive at exactly this comparison.
  if now() >= deadline then
    raise exception 'The edit window for this review has closed' using errcode = '42501';
  end if;

  -- Mirrors `reviewBodyMin` / `reviewBodyMax`. A body that is present but too
  -- short to be useful dilutes the page without informing anyone, which is the
  -- same rule the submission schema applies.
  if new_body is not null
     and (char_length(new_body) < 40 or char_length(new_body) > 4000) then
    raise exception 'A review needs to be between 40 and 4000 characters, or blank'
      using errcode = '22023';
  end if;

  keep := coalesce(new_overall, r.overall_rating);

  -- The table's own CHECK would catch this a moment later; saying it here
  -- names the field rather than the constraint.
  if keep < 1 or keep > 5 then
    raise exception 'A rating is a whole number from 1 to 5' using errcode = '22023';
  end if;

  if new_categories is not null then
    if jsonb_typeof(new_categories) <> 'array' then
      raise exception 'Category ratings must be an array' using errcode = '22023';
    end if;

    -- A review with no comparable signal at all is worse than no review: the
    -- category scores are what the intelligence layer comes from. The
    -- submission flow requires at least one, and a correction may not undo
    -- that by clearing the lot.
    if jsonb_array_length(new_categories) = 0 then
      raise exception 'Rate at least one category' using errcode = '22023';
    end if;

    -- Every key must exist, every rating must be in range, and no category may
    -- appear twice — a category rated twice would count twice in the rollup.
    if exists (
      select 1 from jsonb_array_elements(new_categories) as e
      where not exists (
        select 1 from review_category_defs d where d.key = e->>'categoryKey'
      )
    ) then
      raise exception 'Unknown category' using errcode = '22023';
    end if;

    if exists (
      select 1 from jsonb_array_elements(new_categories) as e
      where (e->>'rating')::int not between 1 and 5
    ) then
      raise exception 'A rating is a whole number from 1 to 5' using errcode = '22023';
    end if;

    if (select count(distinct e->>'categoryKey') from jsonb_array_elements(new_categories) as e)
       <> jsonb_array_length(new_categories) then
      raise exception 'Each category can only be rated once' using errcode = '22023';
    end if;
  end if;

  select coalesce(array_agg(distinct flag), '{}')
    into merged
    from unnest(coalesce(r.safety_flags, '{}') || coalesce(add_flags, '{}')) as flag;

  -- Scoped to this statement. `true` is `is_local`, so it is gone at commit
  -- whatever happens next in the session.
  perform set_config('livd.correction', 'on', true);

  update reviews
     set body            = new_body,
         would_recommend = new_recommend,
         overall_rating  = keep,
         safety_flags    = merged,
         status          = case when hold then 'pending_moderation'::review_status
                                else r.status end
   where id = target_review;

  if new_categories is not null then
    delete from review_category_ratings where review_id = target_review;

    insert into review_category_ratings (review_id, category_key, rating)
    select target_review, e->>'categoryKey', (e->>'rating')::smallint
      from jsonb_array_elements(new_categories) as e;
  end if;

  perform set_config('livd.correction', 'off', true);

  -- Only when the review actually left the page. A typo fix is recorded by
  -- `review_snapshots`, which is what that table is for; writing every
  -- correction into the moderation trail would bury the decisions a person
  -- made in a list of the ones nobody did.
  if hold then
    select role into actor_r from profiles where id = actor;

    insert into moderation_actions
      (actor_id, actor_role, subject_type, subject_id, action, reason,
       previous_status, new_status)
    values
      (actor, actor_r, 'review', target_review, 'set_status:pending_moderation',
       'An author correction raised a flag that is read by a person before it goes back up.',
       r.status::text, 'pending_moderation');
  end if;

  return deadline;
end;
$fn$;

-- The five-argument version from 0046 is gone: a default-carrying overload
-- alongside it would make `livd_correct_review(uuid, text, boolean)` ambiguous
-- and fail at call time rather than here.
drop function if exists livd_correct_review(uuid, text, boolean, text[], boolean);

revoke execute on function
  livd_correct_review(uuid, text, boolean, text[], boolean, smallint, jsonb)
  from public, anon;
grant execute on function
  livd_correct_review(uuid, text, boolean, text[], boolean, smallint, jsonb)
  to authenticated;

comment on function livd_correct_review(uuid, text, boolean, text[], boolean, smallint, jsonb) is
  'An author correcting their own published review inside the 24-hour window: the body, the ratings and the recommendation. Checks the author, the status and the deadline against now() rather than against anything the caller sent, adds safety flags without ever removing one, and may hold the review for a moderator but never unhold it. Replacing the category ratings deletes and re-inserts in one block, so the stats triggers never see an empty set. Returns the moment the window closes.';
