-- ===========================================================================
-- Livd — 0032 · User sanctions
--
-- `profiles.status` has been a bare column since 0001. It could be moved with
-- no reason, no duration, no actor, no related case and no record — and 0020
-- closed the "no record" half by routing every change through
-- `livd_set_user_status`, which demands a reason and writes an audit row.
--
-- What was still missing is the sanction itself: the thing with a start, an
-- end, a category and a case behind it, which is what somebody reviewing a
-- decision six months later actually needs to read.
--
-- ACCOUNT STANDING IS NOT REVIEW STATUS
--
-- The two are modelled separately and stay that way. All four of these are
-- reachable states and all four are ordinary:
--
--   active account   + removed review     one bad review, nothing more
--   active account   + a warning recorded
--   suspended account + published reviews the reviews were fine; the conduct was not
--   banned account   + published reviews  the same, permanently
--
-- Nothing here touches a review, and nothing in the moderation path touches an
-- account. A system that conflates them punishes people twice for one thing, or
-- not at all for another.
--
-- WHO MAY DO WHAT
--
--   restricted   moderator      ordinary moderation; some features limited
--   suspended    trust_admin    a pause, with a date on it
--   banned       admin          a conclusion
--
-- Escalating in severity escalates the authorisation required, because the
-- point at which a decision becomes hard to reverse is the point at which it
-- should need somebody more senior.
-- ===========================================================================

create table sanction_reason_defs (
  key         text primary key,
  label       text not null,
  description text not null,
  /** The lightest sanction this reason usually warrants. A default, not a rule. */
  suggested_action user_status not null default 'restricted',
  sort_order  int  not null default 0,
  is_active   boolean not null default true
);

insert into sanction_reason_defs (key, label, description, suggested_action, sort_order) values
  ('spam',                'Spam', 'Promotional or automated posting.', 'restricted', 10),
  ('review_manipulation', 'Review manipulation',
   'Coordinated, incentivised or fabricated reviewing.', 'suspended', 20),
  ('fabricated_content',  'Fabricated content',
   'Reviewing a property they did not live at.', 'suspended', 30),
  ('harassment',          'Harassment',
   'Targeted abuse of another person.', 'suspended', 40),
  ('threats',             'Threats',
   'Content threatening harm to a person.', 'banned', 50),
  ('personal_information','Publishing personal information',
   'Posting content that identifies a person.', 'suspended', 60),
  ('impersonation',       'Impersonation',
   'Claiming to be somebody they are not.', 'suspended', 70),
  ('ban_evasion',         'Ban evasion',
   'Returning after a ban under another account.', 'banned', 80),
  ('platform_abuse',      'Platform abuse',
   'Abuse of reporting, verification or another system.', 'restricted', 90),
  ('other',               'Other',
   'Anything else. Say what it is — this one is read.', 'restricted', 999);

alter table sanction_reason_defs enable row level security;

create policy sanction_reasons_read on sanction_reason_defs
  for select using (livd_is_moderator());

-- ---------------------------------------------------------------------------
-- The sanctions themselves
-- ---------------------------------------------------------------------------

create table user_sanctions (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,

  action user_status not null
    check (action in ('restricted', 'suspended', 'banned')),

  reason_key text not null references sanction_reason_defs(key),
  /** The written reason. Required — a category alone explains nothing. */
  reason text not null check (char_length(reason) between 3 and 1000),

  /** The investigation this came out of, where there was one. */
  case_id uuid references ts_cases(id) on delete set null,

  applied_by uuid references profiles(id) on delete set null,

  starts_at timestamptz not null default now(),
  /**
   * When it lifts by itself.
   *
   * Null means indefinite, which is a ban and occasionally a suspension
   * pending an appeal. A suspension with no end date is legitimate but should
   * be a deliberate choice, so the application asks for a duration and the
   * database allows the absence.
   */
  ends_at timestamptz,

  /** Lifted early. Recorded rather than deleted, like everything else here. */
  lifted_at     timestamptz,
  lifted_by     uuid references profiles(id) on delete set null,
  lifted_reason text,

  created_at timestamptz not null default now(),

  constraint user_sanctions_chronology check (ends_at is null or ends_at > starts_at)
);

create index user_sanctions_user_idx on user_sanctions (user_id, created_at desc);
create index user_sanctions_case_idx on user_sanctions (case_id) where case_id is not null;
create index user_sanctions_active_idx on user_sanctions (user_id)
  where lifted_at is null;
create index user_sanctions_expiry_idx on user_sanctions (ends_at)
  where lifted_at is null and ends_at is not null;

create trigger user_sanctions_no_delete
  before delete on user_sanctions
  for each row execute function livd_forbid_mutation();

revoke delete, truncate on table user_sanctions from anon, authenticated, service_role;
revoke insert, update on table user_sanctions from anon, authenticated;

comment on table user_sanctions is
  'Account sanctions, with a reason, an actor, a duration and the case behind them. Lifted rather than deleted; never removed.';

alter table user_sanctions enable row level security;

create policy user_sanctions_read_moderator on user_sanctions
  for select using (livd_is_moderator());

/**
 * A person may see what has been done to their own account.
 *
 * The category, the written reason, the dates. Not who applied it — naming the
 * individual moderator to somebody they just sanctioned is how moderators get
 * harassed, and the accountability that matters is Livd's rather than any one
 * person's.
 */
create or replace function livd_my_sanctions()
returns table (
  action     user_status,
  reason_key text,
  reason     text,
  starts_at  timestamptz,
  ends_at    timestamptz,
  lifted_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.action, s.reason_key, s.reason, s.starts_at, s.ends_at, s.lifted_at
  from user_sanctions s
  where s.user_id = auth.uid()
  order by s.created_at desc
  limit 20;
$$;

revoke execute on function livd_my_sanctions() from public, anon;
grant execute on function livd_my_sanctions() to authenticated;

-- ---------------------------------------------------------------------------
-- Applying one
-- ---------------------------------------------------------------------------

/**
 * Sanctions an account.
 *
 * The sanction row, the profile status and the audit entry are one
 * transaction, so an account whose standing changed without a recorded reason
 * is not a state this database can reach.
 *
 * Nothing here touches a review. Removing content is a separate decision with
 * its own reason and its own record.
 */
create or replace function livd_apply_sanction(
  target_user_id uuid,
  sanction_action user_status,
  reason_key      text,
  sanction_reason text,
  duration_days   integer default null,
  related_case_id uuid    default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor       uuid := auth.uid();
  target_role user_role;
  reason_row  sanction_reason_defs%rowtype;
  new_id      uuid;
  ends        timestamptz;
begin
  if actor is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if sanction_action not in ('restricted', 'suspended', 'banned') then
    raise exception 'That is not a sanction' using errcode = '22023';
  end if;

  -- Severity decides who may apply it. The point at which a decision becomes
  -- hard to reverse is the point at which it should need somebody more senior.
  if sanction_action = 'restricted' and not livd_is_moderator() then
    raise exception 'Only a moderator may restrict an account' using errcode = '42501';
  end if;

  if sanction_action = 'suspended' and not livd_is_trust_admin() then
    raise exception 'Suspending an account requires Trust and Safety authorisation'
      using errcode = '42501';
  end if;

  if sanction_action = 'banned' and not livd_is_super_admin() then
    raise exception 'Only an administrator may ban an account' using errcode = '42501';
  end if;

  if target_user_id = actor then
    raise exception 'You cannot sanction your own account' using errcode = '42501';
  end if;

  select role into target_role from profiles where id = target_user_id for update;
  if target_role is null then
    raise exception 'No such account' using errcode = 'P0002';
  end if;

  if target_role in ('moderator', 'trust_admin', 'admin') and not livd_is_super_admin() then
    raise exception 'Only an administrator may act on a privileged account'
      using errcode = '42501';
  end if;

  select * into reason_row from sanction_reason_defs where key = reason_key and is_active;
  if reason_row.key is null then
    raise exception 'Select a reason for this sanction' using errcode = '22023';
  end if;

  if sanction_reason is null or char_length(btrim(sanction_reason)) < 3 then
    raise exception 'A reason is required, for the audit trail' using errcode = '22023';
  end if;

  -- A ban has no end date. Accepting one would imply it lifts by itself.
  if sanction_action = 'banned' then
    ends := null;
  elsif duration_days is not null and duration_days > 0 then
    ends := now() + make_interval(days => duration_days);
  else
    ends := null;
  end if;

  insert into user_sanctions
    (user_id, action, reason_key, reason, case_id, applied_by, ends_at)
  values
    (target_user_id, sanction_action, reason_key, btrim(sanction_reason),
     related_case_id, actor, ends)
  returning id into new_id;

  perform set_config('livd.privileged_write', 'on', true);
  update profiles set status = sanction_action where id = target_user_id;
  perform set_config('livd.privileged_write', 'off', true);

  insert into admin_audit_log
    (actor_id, actor_role, action, subject_type, subject_id, outcome, reason, detail)
  select actor, p.role, 'user_sanctioned', 'user', target_user_id, 'succeeded',
         reason_row.label || ' — ' || btrim(sanction_reason),
         jsonb_strip_nulls(jsonb_build_object(
           'sanctionId', new_id,
           'action', sanction_action::text,
           'reasonKey', reason_key,
           'caseId', related_case_id,
           'endsAt', ends
         ))
  from profiles p where p.id = actor;

  if related_case_id is not null then
    perform livd_case_event(
      related_case_id, actor, 'sanction_applied',
      'Account ' || sanction_action::text,
      jsonb_build_object('sanctionId', new_id, 'userId', target_user_id)
    );
  end if;

  return new_id;
end;
$$;

/**
 * Lifts a sanction early.
 *
 * Requires the tier that could have applied it — somebody who cannot suspend
 * an account should not be able to un-suspend one either, in both directions.
 */
create or replace function livd_lift_sanction(sanction_id uuid, why text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor    uuid := auth.uid();
  target   uuid;
  applied  user_status;
  the_case uuid;
  remaining user_status;
begin
  if actor is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if why is null or char_length(btrim(why)) < 3 then
    raise exception 'A reason is required, for the audit trail' using errcode = '22023';
  end if;

  select user_id, action, case_id into target, applied, the_case
  from user_sanctions where id = sanction_id for update;

  if target is null then
    raise exception 'No such sanction' using errcode = 'P0002';
  end if;

  if applied = 'restricted' and not livd_is_moderator() then
    raise exception 'Only a moderator may lift a restriction' using errcode = '42501';
  end if;
  if applied = 'suspended' and not livd_is_trust_admin() then
    raise exception 'Lifting a suspension requires Trust and Safety authorisation'
      using errcode = '42501';
  end if;
  if applied = 'banned' and not livd_is_super_admin() then
    raise exception 'Only an administrator may lift a ban' using errcode = '42501';
  end if;

  update user_sanctions
  set lifted_at = now(), lifted_by = actor, lifted_reason = btrim(why)
  where id = sanction_id and lifted_at is null;

  -- The account returns to the strongest sanction still standing, or to active.
  select s.action into remaining
  from user_sanctions s
  where s.user_id = target
    and s.lifted_at is null
    and (s.ends_at is null or s.ends_at > now())
  order by case s.action
             when 'banned' then 3 when 'suspended' then 2 else 1 end desc
  limit 1;

  perform set_config('livd.privileged_write', 'on', true);
  update profiles set status = coalesce(remaining, 'active') where id = target;
  perform set_config('livd.privileged_write', 'off', true);

  insert into admin_audit_log
    (actor_id, actor_role, action, subject_type, subject_id, outcome, reason, detail)
  select actor, p.role, 'user_sanction_lifted', 'user', target, 'succeeded', btrim(why),
         jsonb_build_object('sanctionId', sanction_id, 'was', applied::text)
  from profiles p where p.id = actor;

  if the_case is not null then
    perform livd_case_event(
      the_case, actor, 'sanction_lifted', 'Sanction lifted',
      jsonb_build_object('sanctionId', sanction_id)
    );
  end if;
end;
$$;

create or replace function livd_list_sanctions(
  target_user_id uuid default null,
  only_active    boolean default false,
  page_size      integer default 50
)
returns table (
  id         uuid,
  user_id    uuid,
  action     user_status,
  reason_key text,
  reason     text,
  case_id    uuid,
  case_reference text,
  applied_by uuid,
  starts_at  timestamptz,
  ends_at    timestamptz,
  lifted_at  timestamptz,
  lifted_by  uuid,
  lifted_reason text,
  is_active  boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not livd_is_moderator() then
    raise exception 'Not authorised to read sanctions' using errcode = '42501';
  end if;

  return query
  select s.id, s.user_id, s.action, s.reason_key, s.reason,
         s.case_id, c.reference, s.applied_by,
         s.starts_at, s.ends_at, s.lifted_at, s.lifted_by, s.lifted_reason,
         (s.lifted_at is null and (s.ends_at is null or s.ends_at > now())),
         s.created_at
  from user_sanctions s
  left join ts_cases c on c.id = s.case_id
  where (target_user_id is null or s.user_id = target_user_id)
    and (not only_active
         or (s.lifted_at is null and (s.ends_at is null or s.ends_at > now())))
  order by s.created_at desc, s.id desc
  limit greatest(1, least(coalesce(page_size, 50), 200));
end;
$$;

revoke execute on function livd_apply_sanction(uuid, user_status, text, text, integer, uuid)
  from public, anon;
revoke execute on function livd_lift_sanction(uuid, text)             from public, anon;
revoke execute on function livd_list_sanctions(uuid, boolean, integer) from public, anon;

grant execute on function livd_apply_sanction(uuid, user_status, text, text, integer, uuid)
  to authenticated;
grant execute on function livd_lift_sanction(uuid, text)              to authenticated;
grant execute on function livd_list_sanctions(uuid, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Expiry
--
-- A suspension with a date on it has to actually end, and nothing in a request
-- path will notice that it has. Hourly, and cheap: the partial index means the
-- scan only touches sanctions that are still running and have an end date.
-- ---------------------------------------------------------------------------

create or replace function livd_expire_sanctions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expired integer := 0;
  row_user uuid;
  remaining user_status;
begin
  for row_user in
    select distinct s.user_id
    from user_sanctions s
    where s.lifted_at is null
      and s.ends_at is not null
      and s.ends_at <= now()
  loop
    select s.action into remaining
    from user_sanctions s
    where s.user_id = row_user
      and s.lifted_at is null
      and (s.ends_at is null or s.ends_at > now())
    order by case s.action
               when 'banned' then 3 when 'suspended' then 2 else 1 end desc
    limit 1;

    perform set_config('livd.privileged_write', 'on', true);
    update profiles
    set status = coalesce(remaining, 'active')
    where id = row_user and status is distinct from coalesce(remaining, 'active');
    perform set_config('livd.privileged_write', 'off', true);

    expired := expired + 1;
  end loop;

  return expired;
end;
$$;

revoke execute on function livd_expire_sanctions() from public, anon, authenticated;

select cron.schedule(
  'livd-expire-sanctions',
  '7 * * * *',
  'select livd_expire_sanctions();'
);

comment on function livd_expire_sanctions() is
  'Returns accounts to their correct standing when a timed sanction ends. Nothing in a request path would notice.';
