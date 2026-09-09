-- ===========================================================================
-- Livd — 0023 · The administrative audit log
--
-- `moderation_actions` records decisions: a review was removed, a claim was
-- approved, a role was granted. What it cannot record is a *reading* — that
-- somebody opened a tenancy agreement, or looked up who wrote a review — for
-- the simple reason that a read is not a decision and there was never a row to
-- attach it to.
--
-- On a platform that promises "anonymous to the public, accountable to Livd",
-- the reads are the half that matters. A moderation decision is visible in its
-- effect; an unlogged look at somebody's identity leaves nothing behind at all.
--
-- So this table is separate from `moderation_actions` rather than an extension
-- of it. The two answer different questions — "what was done to this content"
-- and "who touched this person's information" — and a reader of one should not
-- have to filter out the other. `moderation_actions` stays exactly as it is.
--
-- WHY `action` IS TEXT AND NOT AN ENUM
--
-- Every other controlled vocabulary in this schema is an enum or a reference
-- table, and this one deliberately is not. An audit write must never fail. An
-- enum makes an unrecognised value an error, and a foreign key to a definitions
-- table makes a missing row an error — either would turn "somebody added an
-- action type and forgot the migration" into "the sensitive thing happened and
-- nothing recorded it", which is the exact failure this table exists to
-- prevent.
--
-- The vocabulary is enforced where a mistake is cheap instead: `AdminAuditAction`
-- in src/server/admin/audit.ts is a union type, and the admin action layer is
-- the only writer. Strict in TypeScript, permissive in Postgres, on purpose.
-- ===========================================================================

create table admin_audit_log (
  id bigserial primary key,

  -- Severed rather than removed when an administrator deletes their account,
  -- matching `moderation_actions` since 0017. A record with holes in it is not
  -- a record, and the person the entry is *about* has rights the actor's
  -- erasure does not extinguish.
  actor_id   uuid references profiles(id) on delete set null,

  -- What the actor was at the time, not what they are now. A demoted
  -- administrator's past access was still administrator access, and an audit
  -- log that re-reads the current role would quietly rewrite history every time
  -- somebody changed jobs.
  actor_role user_role not null,

  action       text not null,
  subject_type text not null check (subject_type in (
    'user', 'review', 'property', 'claim', 'verification',
    'case', 'evidence', 'sanction', 'authority_request', 'export', 'security'
  )),
  subject_id uuid,

  -- Whether the attempt succeeded. Denials are recorded too: somebody who
  -- could not reveal an identity tried to, and that is worth knowing.
  outcome text not null default 'succeeded'
    check (outcome in ('succeeded', 'denied', 'failed')),

  -- Required by the application for anything crossing the identity boundary.
  -- Not required here, because an audit write must never fail.
  reason text check (reason is null or char_length(reason) <= 1000),

  -- Structured context: which case, which fields were disclosed, what changed.
  -- Never the sensitive value itself — an audit log that quotes the email it is
  -- recording access to has become a second copy of the thing it protects.
  detail jsonb not null default '{}'::jsonb,

  -- Salted digest of the request origin, never a raw address. Same treatment as
  -- `rate_limit_events.actor_hash`, and for the same reason.
  actor_ip_hash text,

  created_at timestamptz not null default now()
);

comment on table admin_audit_log is
  'Sensitive administrative reads and writes, including denied attempts. Append-only by trigger. Never contains the sensitive value itself, only the fact of access.';
comment on column admin_audit_log.actor_role is
  'The actor''s role at the time of the action. Never re-read from profiles: a demotion must not rewrite history.';
comment on column admin_audit_log.detail is
  'Structured context. Never the value being protected.';

create index admin_audit_actor_idx   on admin_audit_log (actor_id, created_at desc);
create index admin_audit_subject_idx on admin_audit_log (subject_type, subject_id, created_at desc);
create index admin_audit_action_idx  on admin_audit_log (action, created_at desc);
create index admin_audit_recent_idx  on admin_audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Append-only, by trigger
--
-- The same reasoning as 0020's treatment of `moderation_actions`: RLS does not
-- bind the service role, and every administrative write in this application
-- uses it. A policy would leave an administrator free to delete the row saying
-- what they read.
-- ---------------------------------------------------------------------------

create trigger admin_audit_log_append_only
  before update or delete on admin_audit_log
  for each row execute function livd_forbid_mutation();

revoke update, delete, truncate on table admin_audit_log
  from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Readable by trust_admin and above. A moderator does not read the identity
-- access log — they are one of the people it exists to hold accountable, and
-- the case timeline in a later phase is what shows them the history of work
-- they are entitled to see.
--
-- No insert policy: writes come through `livd_record_admin_audit`, which is
-- SECURITY DEFINER and stamps the actor from `auth.uid()`. Nothing can forge
-- an entry attributed to somebody else.
-- ---------------------------------------------------------------------------

alter table admin_audit_log enable row level security;

create policy admin_audit_read_trust on admin_audit_log
  for select using (livd_is_trust_admin());

revoke insert on table admin_audit_log from anon, authenticated;

/**
 * Records one administrative access.
 *
 * The actor and their role are stamped from the session, never accepted as
 * arguments, so an entry cannot be attributed to somebody who did not do the
 * thing. Any signed-in caller may write one — the alternative is an operation
 * that proceeds while its audit write is refused, and a sensitive act that
 * happened without a record is strictly worse than an entry nobody needed.
 */
create or replace function livd_record_admin_audit(
  audit_action  text,
  subject_type  text,
  subject_id    uuid    default null,
  outcome       text    default 'succeeded',
  reason        text    default null,
  detail        jsonb   default '{}'::jsonb,
  actor_ip_hash text    default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  role_now user_role;
  new_id bigint;
begin
  if actor is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select role into role_now from profiles where id = actor;
  if role_now is null then
    raise exception 'No such account' using errcode = 'P0002';
  end if;

  insert into admin_audit_log
    (actor_id, actor_role, action, subject_type, subject_id,
     outcome, reason, detail, actor_ip_hash)
  values
    (actor, role_now, audit_action, subject_type, subject_id,
     coalesce(outcome, 'succeeded'), reason,
     coalesce(detail, '{}'::jsonb), actor_ip_hash)
  returning id into new_id;

  return new_id;
end;
$$;

revoke execute on function livd_record_admin_audit(text, text, uuid, text, text, jsonb, text)
  from public, anon;
grant execute on function livd_record_admin_audit(text, text, uuid, text, text, jsonb, text)
  to authenticated;

comment on function livd_record_admin_audit(text, text, uuid, text, text, jsonb, text) is
  'Writes one audit entry, stamping the actor and their role from the session. The caller cannot name either.';

/**
 * Reads the audit log, newest first.
 *
 * Behind a trust_admin check in the function as well as in the policy, so the
 * boundary holds whether the caller comes through PostgREST or through this.
 */
create or replace function livd_admin_audit_log(
  page_size      integer default 50,
  page_offset    integer default 0,
  filter_action  text    default null,
  filter_subject uuid    default null
)
returns table (
  id           bigint,
  actor_id     uuid,
  actor_role   user_role,
  action       text,
  subject_type text,
  subject_id   uuid,
  outcome      text,
  reason       text,
  detail       jsonb,
  created_at   timestamptz,
  total_count  bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not livd_is_trust_admin() then
    raise exception 'Not authorised to read the audit log' using errcode = '42501';
  end if;

  return query
  select a.id, a.actor_id, a.actor_role, a.action, a.subject_type, a.subject_id,
         a.outcome, a.reason, a.detail, a.created_at,
         count(*) over () as total_count
  from admin_audit_log a
  where (filter_action is null or a.action = filter_action)
    and (filter_subject is null or a.subject_id = filter_subject)
  order by a.created_at desc, a.id desc
  limit greatest(1, least(coalesce(page_size, 50), 200))
  offset greatest(0, coalesce(page_offset, 0));
end;
$$;

revoke execute on function livd_admin_audit_log(integer, integer, text, uuid) from public, anon;
grant execute on function livd_admin_audit_log(integer, integer, text, uuid) to authenticated;

-- `actor_ip_hash` is deliberately absent from what this returns. It exists so
-- that "the same origin did this forty times" is answerable; it is not
-- something to render on a page.
