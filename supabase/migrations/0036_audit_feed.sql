-- ===========================================================================
-- Livd — 0036 · Reading the audit trail
--
-- There are two trails, deliberately:
--
--   `moderation_actions`  what was decided about content and accounts, with
--                         the previous and new state of the thing decided
--   `admin_audit_log`     who touched a person's information, including the
--                         reads, and including the attempts that were refused
--
-- They answer different questions and neither should be folded into the other.
-- A reader of "what happened to this review" does not want identity-access
-- entries interleaved, and 0035 explains why duplicating writes across both
-- would be worse than either.
--
-- But "what has this administrator been doing" is a question that spans both,
-- and until now it could not be asked at all. Answering it is what this
-- migration is for. The union happens here, at the point of reading, where a
-- disagreement between two rows for one act is not possible because there is
-- only ever one row.
--
-- READING THE LOG IS ITSELF RECORDED
--
-- `livd_admin_audit_feed` writes an `audit_log_read` entry in the same
-- statement block as the query it answers. The pattern is the one from 0025:
-- there is no ordering of events in which somebody reads the trail and nothing
-- notes it, because the read and the note are one operation.
--
-- That is not paranoia about colleagues. The audit log is the one place in
-- Livd that lists, in order, every account whose identity has been looked at.
-- Somebody paging through it is doing something worth a line, and a log that
-- exempts its own readers has a hole exactly where the most curious person
-- would look.
--
-- The consequence is that the trail contains entries about being read, which
-- would drown the rest. The page therefore hides them by default — visibly,
-- with a count and a toggle, which is a filter rather than a secret.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- One vocabulary across two trails
--
-- `moderation_actions.action` is a free string built at the call site —
-- 'set_status:removed', 'claim_approved'. `admin_audit_log.action` is the
-- `AdminAuditAction` union from src/server/admin/audit.ts. This maps the first
-- onto the second so a single filter value means the same thing whichever
-- table the row came from.
--
-- Unmapped values pass through unchanged rather than becoming 'other'. An
-- action nobody has taught this function about should look conspicuous in the
-- list, not disappear into a bucket.
-- ---------------------------------------------------------------------------

create or replace function livd_normalise_audit_action(raw text)
returns text
language sql
immutable
as $fn$
  select case
    when raw like 'set_status:%'       then 'review_status_changed'
    when raw like 'set_verification:%' then 'review_verification_changed'
    when raw like 'report_%'           then 'report_resolved'
    when raw like 'claim_%'            then 'property_claim_decided'
    when raw like 'verification_%'     then 'verification_decided'
    when raw = 'role_changed'          then 'user_role_changed'
    when raw = 'status_changed'        then 'user_status_changed'
    else raw
  end;
$fn$;

comment on function livd_normalise_audit_action(text) is
  'Maps a moderation_actions action string onto the AdminAuditAction vocabulary. Unknown values pass through unchanged, on purpose.';

-- ---------------------------------------------------------------------------
-- The feed
--
-- `actor_email_masked` is the same masking the user directory uses, and it is
-- here for a reason worth stating: an audit trail whose actor column reads
-- 'a4f3b2c1' is a trail nobody uses. Accountability means a name a person
-- recognises. The mask keeps it to the least that identifies — and note the
-- direction of travel, which is the opposite of everywhere else in this
-- schema: these are administrators being identified to Trust & Safety, not
-- residents being identified to anybody.
--
-- The actor's *own* identity is never revealed by this: the mask is applied in
-- SQL, so no raw address enters the application at any point.
-- ---------------------------------------------------------------------------

create or replace function livd_admin_audit_feed(
  page_size           integer     default 50,
  page_offset         integer     default 0,
  filter_source       text        default null,
  filter_action       text        default null,
  filter_actor        uuid        default null,
  filter_outcome      text        default null,
  filter_subject_type text        default null,
  filter_subject      uuid        default null,
  since               timestamptz default null,
  until               timestamptz default null,
  include_reads       boolean     default false
)
returns table (
  entry_id           text,
  source             text,
  actor_id           uuid,
  actor_role         user_role,
  actor_email_masked text,
  action             text,
  raw_action         text,
  subject_type       text,
  subject_id         uuid,
  outcome            text,
  reason             text,
  detail             jsonb,
  created_at         timestamptz,
  total_count        bigint
)
language plpgsql
volatile
security definer
set search_path = public
as $fn$
begin
  if not livd_is_trust_admin() then
    raise exception 'Not authorised to read the audit trail' using errcode = '42501';
  end if;

  return query
  with unioned as (
    select
      'a:' || a.id::text                          as entry_id,
      'audit'::text                               as source,
      a.actor_id                                  as actor_id,
      a.actor_role                                as actor_role,
      livd_normalise_audit_action(a.action)       as action,
      a.action                                    as raw_action,
      a.subject_type                              as subject_type,
      a.subject_id                                as subject_id,
      a.outcome                                   as outcome,
      a.reason                                    as reason,
      a.detail                                    as detail,
      a.created_at                                as created_at
    from admin_audit_log a

    union all

    select
      'm:' || m.id::text,
      'moderation'::text,
      m.actor_id,
      m.actor_role,
      livd_normalise_audit_action(m.action),
      m.action,
      m.subject_type,
      m.subject_id,
      -- A moderation row exists only because the decision was made. There is
      -- no refused-attempt equivalent in that table, which is one of the
      -- reasons the audit log exists alongside it.
      'succeeded'::text,
      m.reason,
      jsonb_strip_nulls(jsonb_build_object(
        'previousStatus', m.previous_status,
        'newStatus',      m.new_status
      )) || coalesce(m.metadata, '{}'::jsonb),
      m.created_at
    from moderation_actions m
  ),
  filtered as (
    select u.*
    from unioned u
    where (filter_source       is null or u.source        = filter_source)
      and (filter_action       is null or u.action        = filter_action)
      and (filter_actor        is null or u.actor_id      = filter_actor)
      and (filter_outcome      is null or u.outcome       = filter_outcome)
      and (filter_subject_type is null or u.subject_type  = filter_subject_type)
      and (filter_subject      is null or u.subject_id    = filter_subject)
      and (since               is null or u.created_at   >= since)
      and (until               is null or u.created_at   <= until)
      -- Hidden unless asked for, never removed. See the header.
      and (coalesce(include_reads, false) or u.action <> 'audit_log_read')
  )
  select
    f.entry_id,
    f.source,
    f.actor_id,
    f.actor_role,
    case when u.email is null then null else livd_mask_email(u.email::text) end,
    f.action,
    f.raw_action,
    f.subject_type,
    f.subject_id,
    f.outcome,
    f.reason,
    f.detail,
    f.created_at,
    count(*) over () as total_count
  from filtered f
  left join auth.users u on u.id = f.actor_id
  order by f.created_at desc, f.entry_id desc
  limit  greatest(1, least(coalesce(page_size, 50), 200))
  offset greatest(0, coalesce(page_offset, 0));

  -- After the query rather than before it, so a read does not appear in its
  -- own results. Same transaction either way: the record cannot be separated
  -- from the read that caused it.
  --
  -- The detail says what was looked at, not what was found. Recording the
  -- returned rows would make this entry a summary of the log, which is the one
  -- thing an entry in the log must never be.
  perform livd_record_admin_audit(
    'audit_log_read',
    'security',
    filter_subject,
    'succeeded',
    null,
    jsonb_strip_nulls(jsonb_build_object(
      'source',       filter_source,
      'action',       filter_action,
      'actor',        filter_actor::text,
      'outcome',      filter_outcome,
      'subjectType',  filter_subject_type,
      'since',        since::text,
      'until',        until::text,
      'includeReads', include_reads,
      'page',         greatest(0, coalesce(page_offset, 0)) / greatest(1, coalesce(page_size, 50)) + 1
    )),
    null
  );
end;
$fn$;

revoke execute on function livd_admin_audit_feed(
  integer, integer, text, text, uuid, text, text, uuid, timestamptz, timestamptz, boolean
) from public, anon;
grant execute on function livd_admin_audit_feed(
  integer, integer, text, text, uuid, text, text, uuid, timestamptz, timestamptz, boolean
) to authenticated;

comment on function livd_admin_audit_feed(
  integer, integer, text, text, uuid, text, text, uuid, timestamptz, timestamptz, boolean
) is
  'Both trails, newest first, for Trust and Safety. Records that it was read, in the same transaction as the read.';

-- ---------------------------------------------------------------------------
-- What has been happening
--
-- The counts behind the page header. Deliberately does not record a read: it
-- runs on the same page load as the feed, which does, and two entries for one
-- visit would say something false about how many times the trail was opened.
-- ---------------------------------------------------------------------------

create or replace function livd_admin_audit_summary(
  since timestamptz default null
)
returns table (
  action      text,
  entries     bigint,
  actors      bigint,
  denials     bigint,
  last_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not livd_is_trust_admin() then
    raise exception 'Not authorised to read the audit trail' using errcode = '42501';
  end if;

  return query
  with unioned as (
    select livd_normalise_audit_action(a.action) as action,
           a.actor_id, a.outcome, a.created_at
    from admin_audit_log a
    union all
    select livd_normalise_audit_action(m.action), m.actor_id, 'succeeded'::text, m.created_at
    from moderation_actions m
  )
  select u.action,
         count(*)::bigint,
         count(distinct u.actor_id)::bigint,
         count(*) filter (where u.outcome = 'denied')::bigint,
         max(u.created_at)
  from unioned u
  where (since is null or u.created_at >= since)
  group by u.action
  order by count(*) desc, u.action;
end;
$fn$;

revoke execute on function livd_admin_audit_summary(timestamptz) from public, anon;
grant  execute on function livd_admin_audit_summary(timestamptz) to authenticated;

comment on function livd_admin_audit_summary(timestamptz) is
  'Counts by action across both trails. Does not record a read: the feed on the same page already does.';

-- ---------------------------------------------------------------------------
-- Who has been doing it
--
-- For the actor filter, and for the question the summary cannot answer: not
-- "how much happened" but "who did it, and when were they last here".
-- ---------------------------------------------------------------------------

create or replace function livd_admin_audit_actors(
  since timestamptz default null
)
returns table (
  actor_id           uuid,
  actor_role         user_role,
  actor_email_masked text,
  entries            bigint,
  denials            bigint,
  last_at            timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not livd_is_trust_admin() then
    raise exception 'Not authorised to read the audit trail' using errcode = '42501';
  end if;

  return query
  with unioned as (
    select a.actor_id, a.actor_role, a.outcome, a.created_at
    from admin_audit_log a
    union all
    select m.actor_id, m.actor_role, 'succeeded'::text, m.created_at
    from moderation_actions m
  ),
  grouped as (
    select u.actor_id,
           -- The most recent role seen in the trail, not the current one. Same
           -- rule as everywhere else here: a demotion does not rewrite what
           -- somebody was when they acted.
           (array_agg(u.actor_role order by u.created_at desc)
              filter (where u.actor_role is not null))[1] as actor_role,
           count(*)::bigint                                as entries,
           count(*) filter (where u.outcome = 'denied')::bigint as denials,
           max(u.created_at)                               as last_at
    from unioned u
    where (since is null or u.created_at >= since)
      and u.actor_id is not null
    group by u.actor_id
  )
  select g.actor_id,
         g.actor_role,
         case when usr.email is null then null else livd_mask_email(usr.email::text) end,
         g.entries,
         g.denials,
         g.last_at
  from grouped g
  left join auth.users usr on usr.id = g.actor_id
  order by g.last_at desc;
end;
$fn$;

revoke execute on function livd_admin_audit_actors(timestamptz) from public, anon;
grant  execute on function livd_admin_audit_actors(timestamptz) to authenticated;

comment on function livd_admin_audit_actors(timestamptz) is
  'Administrators present in either trail, with masked identity. Trust and Safety only.';
