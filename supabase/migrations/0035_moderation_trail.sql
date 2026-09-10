-- ===========================================================================
-- Livd — 0035 · The moderation trail, made whole
--
-- Phase 2 built `admin_audit_log` and the administrative action layer that
-- writes to it, and every operation added since has gone through them. What
-- neither touched is the moderation work that existed before: setting a
-- review's status, changing its verification level, resolving a report,
-- deciding a property claim. Those four still ran the way they always had —
-- a service-role UPDATE, followed by a separate INSERT into
-- `moderation_actions`.
--
-- Reading that code carefully turns up something worse than an omission:
--
--     const { error } = await admin.from('reviews').update({ status })...
--     if (error) throw ...
--
--     await admin.from('moderation_actions').insert({ ... });   -- unchecked
--
-- The record's error is never examined. If that insert fails — a constraint, a
-- dropped connection, a policy change nobody thought about — the review is
-- removed and *nothing anywhere says who removed it or why*. The operation
-- reports success. And because they are two statements rather than one, a
-- process that dies in between produces the same result on a good day.
--
-- This is precisely the failure the audit layer was built to make impossible,
-- and it was sitting in the four oldest moderation paths the whole time. A
-- record written on a best-effort basis is not a record; it is a record most of
-- the time, which is indistinguishable from a record right up to the moment
-- somebody needs it.
--
-- So these four move into the database and become atomic, the same way
-- `livd_set_user_role` did in 0020. The change and the entry that explains it
-- are one statement block. There is no ordering of events in which a review is
-- removed and the reason is missing, because there is no longer a moment
-- between them.
--
-- WHY NOT WRITE TO admin_audit_log AS WELL
--
-- Because two rows for one act can disagree, and then a reader has to decide
-- which trail is lying. `moderation_actions` is the right home for these: it is
-- what it has always been for, it carries previous and new status which the
-- audit table does not, and it has been append-only by trigger since 0020. The
-- two trails stay separate and are unified where they are *read*, in 0036.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- What the actor was at the time
--
-- Same reasoning as `admin_audit_log.actor_role` in 0023: a demoted moderator's
-- past decisions were still moderator decisions, and re-reading the current
-- role at display time would quietly rewrite history whenever somebody changed
-- jobs.
--
-- Nullable, and left null for every existing row, because those rows genuinely
-- do not know. Back-filling from today's `profiles.role` would be inventing an
-- answer, and a trail that invents answers is worse than one with an honest
-- gap in it.
-- ---------------------------------------------------------------------------

alter table moderation_actions add column if not exists actor_role user_role;

comment on column moderation_actions.actor_role is
  'The actor''s role at the time of the decision. Null for rows written before 0035 — never back-filled, because those rows do not know.';

-- ---------------------------------------------------------------------------
-- A review's status
--
-- The most consequential thing a moderator does to content, and until now the
-- one whose record could silently fail to be written.
--
-- Note what is absent: no branch here deletes anything. A review is never
-- removed from the database, only moved to a status the public cannot see, and
-- the row saying who did that survives whatever happens to the account that
-- did it.
-- ---------------------------------------------------------------------------

create or replace function livd_set_review_status(
  target_review uuid,
  new_status    review_status,
  why           text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  actor    uuid := auth.uid();
  actor_r  user_role;
  previous review_status;
begin
  if actor is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if not livd_is_moderator() then
    raise exception 'Only a moderator may change a review status' using errcode = '42501';
  end if;

  if why is null or char_length(btrim(why)) < 3 then
    raise exception 'A reason is required, for the audit trail' using errcode = '22023';
  end if;

  select role into actor_r from profiles where id = actor;

  -- Locked, so two moderators acting on the same review at the same moment
  -- cannot both record the same previous status.
  select status into previous from reviews where id = target_review for update;

  if previous is null then
    raise exception 'No such review' using errcode = 'P0002';
  end if;

  -- Idempotent: a retried request must not write a second entry.
  if previous = new_status then
    return;
  end if;

  update reviews set status = new_status where id = target_review;

  insert into moderation_actions
    (actor_id, actor_role, subject_type, subject_id, action, reason,
     previous_status, new_status)
  values
    (actor, actor_r, 'review', target_review, 'set_status:' || new_status::text,
     btrim(why), previous::text, new_status::text);
end;
$fn$;

revoke execute on function livd_set_review_status(uuid, review_status, text) from public, anon;
grant  execute on function livd_set_review_status(uuid, review_status, text) to authenticated;

comment on function livd_set_review_status(uuid, review_status, text) is
  'Changes a review status and records who and why, in one transaction. Never deletes.';

-- ---------------------------------------------------------------------------
-- A review's verification level
--
-- `verified_resident` multiplies a review's weight in the property score, so
-- setting it by hand is a judgement about how much a stranger should trust a
-- number. It now takes a written reason for the same purpose the status change
-- always has — "why is this one verified when no document was ever approved"
-- needs to have an answer somewhere.
--
-- Approving a residency document calls this too, passing a reason that names
-- the record it came from.
-- ---------------------------------------------------------------------------

create or replace function livd_set_review_verification(
  target_review uuid,
  new_level     verification_level,
  why           text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  actor    uuid := auth.uid();
  actor_r  user_role;
  previous verification_level;
begin
  if actor is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if not livd_is_moderator() then
    raise exception 'Only a moderator may change a verification level' using errcode = '42501';
  end if;

  if why is null or char_length(btrim(why)) < 3 then
    raise exception 'A reason is required, for the audit trail' using errcode = '22023';
  end if;

  select role into actor_r from profiles where id = actor;

  select verification_level into previous from reviews where id = target_review for update;

  if previous is null then
    raise exception 'No such review' using errcode = 'P0002';
  end if;

  if previous = new_level then
    return;
  end if;

  update reviews set verification_level = new_level where id = target_review;

  insert into moderation_actions
    (actor_id, actor_role, subject_type, subject_id, action, reason,
     previous_status, new_status)
  values
    (actor, actor_r, 'review', target_review, 'set_verification:' || new_level::text,
     btrim(why), previous::text, new_level::text);
end;
$fn$;

revoke execute on function livd_set_review_verification(uuid, verification_level, text) from public, anon;
grant  execute on function livd_set_review_verification(uuid, verification_level, text) to authenticated;

comment on function livd_set_review_verification(uuid, verification_level, text) is
  'Changes a review verification level and records who and why, in one transaction.';

-- ---------------------------------------------------------------------------
-- Resolving a report
--
-- The reason parameter is `why` rather than `resolution`, which is what it
-- naturally wanted to be called. `review_reports.resolution` is a column this
-- function writes to, and inside an UPDATE the target table's columns are in
-- scope — so `set resolution = btrim(resolution)` is ambiguous, and Postgres
-- resolves that at *call* time rather than at creation. The function would be
-- created without complaint and fail the first time anybody used it.
--
-- This is the second time that has happened here; `documentation_received` in
-- 0033 was the first. `tests/safety/audit-coverage.test.ts` now checks every
-- function in every migration for the same collision.
--
-- Upholding a report is not removing a review, here or anywhere else. The
-- decision is recorded against the review it concerns; taking the review down
-- remains a separate act with its own reason, so a coordinated reporting
-- campaign cannot mechanically produce a removal.
-- ---------------------------------------------------------------------------

create or replace function livd_resolve_report(
  target_report uuid,
  new_status    report_status,
  why           text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  actor       uuid := auth.uid();
  actor_r     user_role;
  previous    report_status;
  the_review  uuid;
begin
  if actor is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if not livd_is_moderator() then
    raise exception 'Only a moderator may resolve a report' using errcode = '42501';
  end if;

  if new_status not in ('upheld', 'dismissed') then
    raise exception 'A report is resolved as upheld or dismissed' using errcode = '22023';
  end if;

  if why is null or char_length(btrim(why)) < 3 then
    raise exception 'A reason is required, for the audit trail' using errcode = '22023';
  end if;

  select role into actor_r from profiles where id = actor;

  select status, review_id into previous, the_review
  from review_reports where id = target_report for update;

  if previous is null then
    raise exception 'No such report' using errcode = 'P0002';
  end if;

  if previous = new_status then
    return;
  end if;

  update review_reports
     set status = new_status,
         resolution = btrim(why),
         resolved_at = now()
   where id = target_report;

  insert into moderation_actions
    (actor_id, actor_role, subject_type, subject_id, action, reason,
     previous_status, new_status)
  values
    (actor, actor_r, 'review', the_review, 'report_' || new_status::text,
     btrim(why), previous::text, new_status::text);
end;
$fn$;

revoke execute on function livd_resolve_report(uuid, report_status, text) from public, anon;
grant  execute on function livd_resolve_report(uuid, report_status, text) to authenticated;

comment on function livd_resolve_report(uuid, report_status, text) is
  'Resolves a report and records the decision, in one transaction. Does not touch the review.';

-- ---------------------------------------------------------------------------
-- Deciding a property claim
--
-- Approving one hands a commercial party a standing relationship with a
-- property page — the ability to respond publicly to reviews of it. That is the
-- decision an owner dispute turns on eighteen months later, and it used to be
-- recorded with no reason at all.
--
-- Only a pending claim can be decided. Re-deciding a revoked claim would be a
-- quiet way to restore access somebody deliberately took away.
-- ---------------------------------------------------------------------------

create or replace function livd_decide_claim(
  target_claim uuid,
  new_status   claim_status,
  why          text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  actor    uuid := auth.uid();
  actor_r  user_role;
  previous claim_status;
begin
  if actor is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if not livd_is_moderator() then
    raise exception 'Only a moderator may decide a claim' using errcode = '42501';
  end if;

  if new_status not in ('approved', 'rejected') then
    raise exception 'A claim is decided as approved or rejected' using errcode = '22023';
  end if;

  if why is null or char_length(btrim(why)) < 3 then
    raise exception 'A reason is required, for the audit trail' using errcode = '22023';
  end if;

  select role into actor_r from profiles where id = actor;

  select status into previous from property_claims where id = target_claim for update;

  if previous is null then
    raise exception 'No such claim' using errcode = 'P0002';
  end if;

  if previous <> 'pending' then
    raise exception 'That claim has already been decided' using errcode = '22023';
  end if;

  -- One approved claim per property. A unique index enforces it, but a
  -- constraint violation is not a sentence anybody can act on — it names an
  -- index rather than saying what to do about it. Refuse in words instead, and
  -- in the same words the local adapter uses.
  if new_status = 'approved' and exists (
    select 1 from property_claims
    where property_id = (select property_id from property_claims where id = target_claim)
      and id <> target_claim
      and status = 'approved'
  ) then
    raise exception 'Another claim on this property is already approved. Revoke it first.'
      using errcode = '22023';
  end if;

  update property_claims
     set status = new_status,
         reviewed_by = actor,
         decided_at = now()
   where id = target_claim;

  insert into moderation_actions
    (actor_id, actor_role, subject_type, subject_id, action, reason,
     previous_status, new_status)
  values
    (actor, actor_r, 'claim', target_claim, 'claim_' || new_status::text,
     btrim(why), previous::text, new_status::text);
end;
$fn$;

revoke execute on function livd_decide_claim(uuid, claim_status, text) from public, anon;
grant  execute on function livd_decide_claim(uuid, claim_status, text) to authenticated;

comment on function livd_decide_claim(uuid, claim_status, text) is
  'Decides a pending property claim and records who and why, in one transaction.';
