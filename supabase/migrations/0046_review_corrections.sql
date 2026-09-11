-- ===========================================================================
-- Livd — 0046 · Corrections, and the columns the guard was not watching
--
-- Since 0004 the database has been ready for an author to correct their own
-- review: `reviews_update_own` admits the author of a published review for
-- twenty-four hours, `livd_guard_review_update` narrows that to the words and
-- the recommendation, and `livd_snapshot_review` keeps what it said before.
--
-- Nothing ever called it. There was no Server Action and no button, so the
-- product told people "you can correct this review for the next 21 hours" and
-- gave them nowhere to do it. This migration is the database half of closing
-- that, and it does three things.
--
-- 1. THE GUARD NOW DENIES BY DEFAULT
--
-- It was a blocklist: twelve named columns that an author may not change, and
-- silence about the rest. Silence is a grant. Running the update path as an
-- ordinary signed-in author, against the live project, three columns it had
-- never been told about turned out to be writable through PostgREST:
--
--     PATCH /rest/v1/reviews?id=eq.<mine>   { "created_at": "<now>" }
--
--       The edit window is `created_at > now() - interval '24 hours'`, and
--       `created_at` was not on the list. So an author could push their own
--       deadline forward, from inside the window, as many times as they liked
--       — a review that never becomes part of the permanent record. It also
--       moves the date the property page prints, which is the one fact a
--       reader uses to decide how much a review still describes the building.
--
--     PATCH ... { "safety_flags": [] }
--
--       The flags the content linter raised for moderator triage, cleared by
--       the person they were raised about.
--
--     PATCH ... { "rent_amount_minor": 1, "tenure_months": 480 }
--
--       Rent feeds a median shown as a property's asking level, and tenure
--       weights the review. Neither is anybody's to revise after publication.
--
-- None of these were reachable through the application, because the
-- application had no edit path at all. They were reachable with the
-- publishable key that ships in every browser bundle, which is the only
-- definition of reachable that counts. The list is inverted here: `body`,
-- `would_recommend` and `updated_at` may move, and every other column of
-- `reviews` may not. A column added later is immutable until somebody says
-- otherwise, which is the failure direction 0040 argued for.
--
-- 2. A CORRECTION THAT RAISES A FLAG IS HELD, THE SAME AS A SUBMISSION
--
-- `submitReview` refuses a body the linter blocks and holds one that alleges
-- something serious, because an unfounded accusation against a named business
-- does damage while it is up. An edit that could not do the same would be a
-- way to publish exactly that content: submit something innocuous, wait for it
-- to go live, then rewrite it.
--
-- So `livd_correct_review` may move a review from `published` to
-- `pending_moderation`, and may add safety flags. It may not do the reverse of
-- either. The status transition is one-way in the function *and* in the guard,
-- and flags are unioned rather than assigned — `old.safety_flags <@
-- new.safety_flags`, checked in the guard, so even a caller that reached the
-- table some other way cannot use this path to clear one.
--
-- WHAT THIS DOES NOT CLAIM
--
-- The linter runs in TypeScript, in the Server Action, and Postgres cannot
-- re-run it. A crafted request that calls this function directly with an empty
-- flag array gets the same treatment a crafted INSERT already gets on the
-- submission path: the content goes up unflagged and is caught by reporting
-- and moderation rather than by the linter. That is the posture Livd already
-- has, and this function is deliberately no weaker than it — it cannot clear a
-- flag, cannot unhold a held review, cannot extend a window and cannot touch
-- anybody else's row.
--
-- 3. THE EXEMPTION IS SCOPED TO THIS FUNCTION
--
-- The guard learns the correction transition the way 0018 taught it the
-- account-deletion one: narrowly, and only when every other column is still.
-- It is additionally gated on a transaction-local setting that only
-- `livd_correct_review` sets. PostgREST gives a client no way to set a GUC
-- outside `request.*`, and each PostgREST request is its own transaction, so a
-- value set by one call is gone by the next. The ownership, status and window
-- conditions are re-checked inside the exemption anyway, so a forged setting
-- would buy nothing that `reviews_update_own` does not already permit.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The guard, inverted
-- ---------------------------------------------------------------------------

create or replace function livd_guard_review_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- Everything a non-moderator may never move. `body`, `would_recommend` and
  -- `updated_at` are absent, and they are the whole of what an author may
  -- change. `updated_at` is overwritten by `reviews_set_updated_at` a moment
  -- later regardless of what arrives here.
  frozen boolean := (
        new.id                        is distinct from old.id
     or new.property_id               is distinct from old.property_id
     or new.author_id                 is distinct from old.author_id
     or new.residency_status          is distinct from old.residency_status
     or new.moved_in_month            is distinct from old.moved_in_month
     or new.moved_out_month           is distinct from old.moved_out_month
     or new.tenure_months             is distinct from old.tenure_months
     or new.overall_rating            is distinct from old.overall_rating
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
     and new.id                        is not distinct from old.id
     and new.property_id               is not distinct from old.property_id
     and new.residency_status          is not distinct from old.residency_status
     and new.moved_in_month            is not distinct from old.moved_in_month
     and new.moved_out_month           is not distinct from old.moved_out_month
     and new.tenure_months             is not distinct from old.tenure_months
     and new.overall_rating            is not distinct from old.overall_rating
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
     and new.overall_rating            is not distinct from old.overall_rating
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

  raise exception 'Only the written review and recommendation may be corrected'
    using errcode = '42501';
end;
$fn$;

comment on function livd_guard_review_update() is
  'What an author may change inside their edit window, as an allow-list: the body, the recommendation, and nothing else. Permits two narrow system transitions — a foreign key nulling author_id on account deletion, and livd_correct_review holding a corrected review for a moderator. A column added to reviews later is immutable until this function says otherwise.';

-- ---------------------------------------------------------------------------
-- The correction itself
--
-- One statement block, for the reason 0035 gives: the change, the flags it
-- raised and the record of why it left the property page cannot be separate
-- statements, because a process that dies between them produces a review
-- nobody can account for.
--
-- Returns the moment the window closes. The page that called it needs to say
-- how long is left, and a deadline derived from the row that was actually
-- written is the only one that cannot disagree with the row.
-- ---------------------------------------------------------------------------

create or replace function livd_correct_review(
  target_review uuid,
  new_body      text,
  new_recommend boolean,
  add_flags     text[] default '{}',
  hold          boolean default false
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

  select coalesce(array_agg(distinct flag), '{}')
    into merged
    from unnest(coalesce(r.safety_flags, '{}') || coalesce(add_flags, '{}')) as flag;

  -- Scoped to this statement. `true` is `is_local`, so it is gone at commit
  -- whatever happens next in the session.
  perform set_config('livd.correction', 'on', true);

  update reviews
     set body            = new_body,
         would_recommend = new_recommend,
         safety_flags    = merged,
         status          = case when hold then 'pending_moderation'::review_status
                                else r.status end
   where id = target_review;

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

revoke execute on function livd_correct_review(uuid, text, boolean, text[], boolean)
  from public, anon;
grant  execute on function livd_correct_review(uuid, text, boolean, text[], boolean)
  to authenticated;

comment on function livd_correct_review(uuid, text, boolean, text[], boolean) is
  'An author correcting their own published review inside the 24-hour window. Checks the author, the status and the deadline against now() rather than against anything the caller sent, adds safety flags without ever removing one, and may hold the review for a moderator but never unhold it. Returns the moment the window closes.';
