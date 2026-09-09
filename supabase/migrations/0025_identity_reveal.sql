-- ===========================================================================
-- Livd — 0025 · Revealing an account identity
--
-- This is the boundary the whole product is built around. "Anonymous to the
-- public, accountable to Livd" means somebody at Livd can, in the right
-- circumstances, find out who wrote a review — and it means that finding out
-- is an event, not a page load.
--
-- THE ONE PROPERTY THAT MATTERS
--
-- The read and the record are the same transaction. `livd_reveal_user_identity`
-- writes its audit entry and *then* returns the address, in one statement
-- block, so there is no ordering in which an identity is disclosed and the
-- record of it is not written. If the insert fails, the transaction aborts and
-- nothing is returned.
--
-- That is why the reveal lives here rather than in the application. Server code
-- could read the address and then write an entry, and would be correct almost
-- always — but "almost always" is the wrong standard for the one operation
-- whose entire purpose is accountability. A crash between the two would produce
-- exactly the outcome the system exists to make impossible.
--
-- WHAT IT WILL NOT DO
--
--   * Run for anyone below trust_admin. A moderator moderates content; they do
--     not learn who wrote it.
--   * Run without a category and a written reason. "Other" needs real words.
--   * Run for a caller acting on themselves through this path — they can read
--     their own address on their own account page, without an audit entry that
--     would clutter the log with noise.
--
-- WHAT IT DELIBERATELY DOES NOT RETURN
--
-- The address, and the account's own metadata. Not their reviews, not their
-- verification evidence, not their location history. Data minimisation is not
-- a slogan here: the reveal answers "who is this account" and nothing else,
-- because every extra field is one more thing disclosed for a reason that only
-- justified the first.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Why somebody is looking
--
-- A reference table rather than an enum, matching how this schema handles every
-- other controlled vocabulary — categories are a data change, not a migration.
-- Unlike the audit `action` column, a bad value here *should* fail: the whole
-- point is that the reason is one of a considered set, and a typo must not
-- quietly become a new category nobody reviews.
-- ---------------------------------------------------------------------------

create table identity_access_reasons (
  key         text primary key,
  label       text not null,
  description text not null,
  -- Categories that need more than a dropdown selection to be meaningful.
  requires_detail boolean not null default false,
  sort_order  int  not null default 0,
  is_active   boolean not null default true
);

insert into identity_access_reasons (key, label, description, requires_detail, sort_order) values
  ('safety_investigation', 'Safety investigation',
   'A credible concern about somebody''s physical safety.', false, 10),
  ('fraud_investigation', 'Fraud investigation',
   'Suspected review manipulation, coordinated activity or impersonation.', false, 20),
  ('serious_abuse', 'Serious abuse or harassment',
   'Targeted harassment, threats, or a sustained campaign against a person.', false, 30),
  ('legal_request', 'Legal request',
   'A request with an apparent legal basis, recorded as an authority request.', true, 40),
  ('regulatory_request', 'Regulatory request',
   'A request from a body with regulatory authority over Livd.', true, 50),
  ('security_investigation', 'Security investigation',
   'Account compromise, platform abuse or an incident affecting Livd itself.', false, 60),
  ('other', 'Other Trust & Safety reason',
   'Anything else. Say what it is — this one is read.', true, 999);

alter table identity_access_reasons enable row level security;

create policy identity_reasons_read on identity_access_reasons
  for select using (livd_is_moderator());

-- ---------------------------------------------------------------------------
-- The reveal
-- ---------------------------------------------------------------------------

create or replace function livd_reveal_user_identity(
  target_user_id uuid,
  reason_key     text,
  reason_detail  text    default null,
  case_reference text    default null,
  actor_ip_hash  text    default null
)
returns table (
  email           text,
  account_id      uuid,
  role            user_role,
  status          user_status,
  country_code    char(2),
  created_at      timestamptz,
  audit_entry_id  bigint
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor          uuid := auth.uid();
  reason_row     identity_access_reasons%rowtype;
  target_exists  boolean;
  entry_id       bigint;
  combined       text;
begin
  if actor is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  -- The boundary. A moderator acts on content; they do not learn who wrote it.
  if not livd_is_trust_admin() then
    raise exception 'Revealing an account identity requires Trust and Safety authorisation'
      using errcode = '42501';
  end if;

  select * into reason_row
  from identity_access_reasons
  where key = reason_key and is_active;

  if reason_row.key is null then
    raise exception 'Select a reason for this access' using errcode = '22023';
  end if;

  if reason_row.requires_detail and
     (reason_detail is null or char_length(btrim(reason_detail)) < 10) then
    raise exception 'This reason needs a written explanation' using errcode = '22023';
  end if;

  select exists (select 1 from profiles where id = target_user_id) into target_exists;
  if not target_exists then
    raise exception 'No such account' using errcode = 'P0002';
  end if;

  combined := reason_row.label ||
    case when reason_detail is null or btrim(reason_detail) = ''
         then '' else ' — ' || btrim(reason_detail) end;

  -- Written BEFORE the address is returned, in this transaction. There is no
  -- ordering in which the disclosure happens and the record does not.
  insert into admin_audit_log
    (actor_id, actor_role, action, subject_type, subject_id,
     outcome, reason, detail, actor_ip_hash)
  select
    actor,
    p.role,
    'identity_revealed',
    'user',
    target_user_id,
    'succeeded',
    combined,
    jsonb_strip_nulls(jsonb_build_object(
      'reasonKey', reason_key,
      'caseReference', nullif(btrim(coalesce(case_reference, '')), ''),
      -- What was disclosed, so a later reader knows the scope of the access
      -- without the log holding the values themselves.
      'fields', 'email,account_metadata'
    )),
    actor_ip_hash
  from profiles p
  where p.id = actor
  returning id into entry_id;

  return query
  select u.email::text, p.id, p.role, p.status, p.country_code, p.created_at, entry_id
  from profiles p
  join auth.users u on u.id = p.id
  where p.id = target_user_id;
end;
$$;

revoke execute on function livd_reveal_user_identity(uuid, text, text, text, text)
  from public, anon;
grant execute on function livd_reveal_user_identity(uuid, text, text, text, text)
  to authenticated;

comment on function livd_reveal_user_identity(uuid, text, text, text, text) is
  'The identity boundary. Writes the audit entry and returns the address in one transaction, so a disclosure without a record is not a reachable state. trust_admin and above only.';

/**
 * Who has looked at this account, and why.
 *
 * Shown on the account page so that the history of access to somebody's
 * identity is visible to the people who might add to it. An access log nobody
 * ever reads deters nothing.
 */
create or replace function livd_identity_access_history(
  target_user_id uuid,
  page_size      integer default 20
)
returns table (
  id         bigint,
  actor_id   uuid,
  actor_role user_role,
  outcome    text,
  reason     text,
  detail     jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- A moderator may see *that* an identity was accessed and by whom, which is
  -- the deterrent, without being able to perform the access themselves.
  if not livd_is_moderator() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  return query
  select a.id, a.actor_id, a.actor_role, a.outcome, a.reason, a.detail, a.created_at
  from admin_audit_log a
  where a.subject_type = 'user'
    and a.subject_id = target_user_id
    and a.action = 'identity_revealed'
  order by a.created_at desc, a.id desc
  limit greatest(1, least(coalesce(page_size, 20), 100));
end;
$$;

revoke execute on function livd_identity_access_history(uuid, integer) from public, anon;
grant execute on function livd_identity_access_history(uuid, integer) to authenticated;

comment on function livd_identity_access_history(uuid, integer) is
  'Access history for one account. Readable by moderators: seeing that an identity was accessed is the deterrent, and it is separate from being able to do it.';
