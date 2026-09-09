-- ===========================================================================
-- Livd — 0020 · Close the role-escalation path
--
-- THE VULNERABILITY
--
-- Since 0004 a moderator could make themselves an administrator from a
-- browser, using nothing but the publishable key and their own session. Three
-- things lined up:
--
--   1. `profiles_moderator_update` was `for update using (livd_is_moderator())`
--      with no `with check`. Postgres reuses the `using` expression as the
--      check when one is omitted, so the policy permitted any new value in any
--      column of any row.
--   2. `livd_guard_profile_self_update` opened with
--      `if livd_is_moderator() then return new; end if;` — the one guard that
--      protected `role` and `status` exempted the very role being constrained.
--   3. `authenticated` holds UPDATE on `profiles` by Supabase default, so
--      PostgREST would accept the write directly. No application code was
--      involved, which is why the `requireRole('admin')` check in
--      `setUserRole` never came into it.
--
-- A single `PATCH /rest/v1/profiles?id=eq.<self>` with `{"role":"admin"}` was
-- the whole exploit. It was unexploited only because no moderator account had
-- been created yet.
--
-- THE FIX
--
-- Three independent layers, so that no single mistake re-opens it:
--
--   Privilege  `authenticated` loses UPDATE on `profiles` and is granted it
--              back on exactly two columns — country and locale. A role write
--              is now refused before any policy is consulted.
--   Policy     `profiles_moderator_update` is dropped outright. Nothing needs
--              it: every administrative profile write goes through a function
--              below.
--   Trigger    `role` and `status` may change only inside a transaction that a
--              sanctioned function has marked. This one binds *every* role,
--              including `service_role` — so a Server Action holding the
--              service key cannot change a role either. Authorisation is not
--              something the application can assert; it is something the
--              database decides.
--
-- The sanctioned functions derive the actor from `auth.uid()` rather than from
-- an argument, and are granted to `authenticated` alone. That is the same
-- shape as `livd_verify_property_location` in 0014, and it is the point: the
-- caller cannot name who it claims to be. Server code passes the user's own
-- session through, and the database evaluates the hierarchy against the real
-- JWT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Role predicates
--
-- `livd_is_moderator` keeps its name and its meaning — "may moderate" — and
-- gains the new role, because a trust_admin moderates too. The two new
-- predicates are what let a policy say something the schema previously could
-- not express.
-- ---------------------------------------------------------------------------

create or replace function livd_is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role in ('moderator', 'trust_admin', 'admin') and status = 'active'
     from profiles where id = auth.uid()),
    false
  );
$$;

/** May reveal an account identity, read verification evidence, work serious cases. */
create or replace function livd_is_trust_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role in ('trust_admin', 'admin') and status = 'active'
     from profiles where id = auth.uid()),
    false
  );
$$;

/** May grant roles and change security configuration. Nothing else outranks it. */
create or replace function livd_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'admin' and status = 'active' from profiles where id = auth.uid()),
    false
  );
$$;

comment on function livd_is_moderator() is
  'True for moderator, trust_admin and admin. "May act on content", not "may see who wrote it".';
comment on function livd_is_trust_admin() is
  'True for trust_admin and admin. The identity boundary: everything this gates is audited.';
comment on function livd_is_super_admin() is
  'True for admin alone. Role grants and security configuration.';

-- WRONG, AND UNDONE BY 0021 — LEFT HERE BECAUSE IT WAS APPLIED.
--
-- The reasoning was that these are reachable over /rest/v1/rpc, which the
-- Supabase linter flags, and that revoking EXECUTE would not break the
-- policies calling them because a policy expression is checked against the
-- table owner's rights. That is false: a policy expression is evaluated with
-- the privileges of the role running the query. Removing the grant did not
-- make the functions unreachable, it made every table whose policies call them
-- unreachable — and it made escalation tests report a blocked write when what
-- they had actually hit was a broken policy.
--
-- 0021 restores the grants and explains the whole thing. Do not re-add this.
revoke execute on function livd_is_moderator()      from public, anon, authenticated;
revoke execute on function livd_is_active_user()    from public, anon, authenticated;
revoke execute on function livd_owns_property(uuid) from public, anon, authenticated;
revoke execute on function livd_is_trust_admin()    from public, anon, authenticated;
revoke execute on function livd_is_super_admin()    from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Layer 1 — privilege
--
-- Column-level, so the two columns a person legitimately edits about
-- themselves keep working while the two that decide what they may do stop
-- being writable by any client role at all.
-- ---------------------------------------------------------------------------

revoke update on table profiles from anon, authenticated;
grant update (country_code, preferred_locale) on table profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Layer 2 — policy
-- ---------------------------------------------------------------------------

drop policy if exists profiles_moderator_update on profiles;

-- `profiles_update_own` survives unchanged and is now the only UPDATE policy:
--   for update using (id = auth.uid()) with check (id = auth.uid())
-- paired with the column grant above, it permits exactly "my own country and
-- locale" and nothing else.

-- ---------------------------------------------------------------------------
-- Layer 3 — trigger
--
-- Binds every role including the table owner and the service role. The flag it
-- looks for can only be set from inside a SECURITY DEFINER function in this
-- file; `set_config` lives in pg_catalog and is not exposed through PostgREST,
-- so a client cannot set it, and even if it could, layer 1 has already taken
-- the column privilege away.
-- ---------------------------------------------------------------------------

create or replace function livd_guard_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role or new.status is distinct from old.status then
    if coalesce(current_setting('livd.privileged_write', true), 'off') <> 'on' then
      raise exception
        'role and status may only be changed through livd_set_user_role or livd_set_user_status'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_self_update on profiles;
drop function if exists livd_guard_profile_self_update();

create trigger profiles_guard_privileged_columns
  before update on profiles
  for each row execute function livd_guard_profile_privileged_columns();

revoke execute on function livd_guard_profile_privileged_columns()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The sanctioned writers
-- ---------------------------------------------------------------------------

/**
 * Grants a role.
 *
 * Administrator only, never to yourself, never leaving the platform without an
 * administrator, always with a reason, always audited — in one transaction, so
 * a role that changed without a record is not a state this database can reach.
 */
create or replace function livd_set_user_role(
  target_user_id uuid,
  new_role       user_role,
  change_reason  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor     uuid := auth.uid();
  previous  user_role;
  remaining integer;
begin
  if actor is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if not livd_is_super_admin() then
    raise exception 'Only an administrator may change a role' using errcode = '42501';
  end if;

  if target_user_id = actor then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;

  if change_reason is null or char_length(btrim(change_reason)) < 3 then
    raise exception 'A reason is required, for the audit trail' using errcode = '22023';
  end if;

  -- Locked, so two administrators acting at once cannot both read `admin` and
  -- both conclude theirs is not the last one.
  select role into previous from profiles where id = target_user_id for update;

  if previous is null then
    raise exception 'No such account' using errcode = 'P0002';
  end if;

  -- Idempotent: a retried request must not write a second audit event.
  if previous = new_role then
    return;
  end if;

  if previous = 'admin' then
    select count(*) into remaining
    from profiles
    where role = 'admin' and status = 'active' and id <> target_user_id;

    if remaining = 0 then
      raise exception 'This is the last administrator and cannot be demoted'
        using errcode = '23514';
    end if;
  end if;

  perform set_config('livd.privileged_write', 'on', true);
  update profiles set role = new_role where id = target_user_id;
  perform set_config('livd.privileged_write', 'off', true);

  insert into moderation_actions
    (actor_id, subject_type, subject_id, action, reason, previous_status, new_status)
  values
    (actor, 'user', target_user_id, 'role_changed', btrim(change_reason),
     previous::text, new_role::text);
end;
$$;

/**
 * Changes an account's standing.
 *
 * Restricting is ordinary moderation. Suspending is not, and neither is acting
 * on another privileged account — a moderator who could suspend an
 * administrator would have found a slower route to the same escalation this
 * migration exists to close.
 *
 * Phase 8 builds the sanction record — duration, related case, expiry — on top
 * of this. The authorisation rules stay here, where the database enforces them.
 */
create or replace function livd_set_user_status(
  target_user_id uuid,
  new_status     user_status,
  change_reason  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor       uuid := auth.uid();
  previous    user_status;
  target_role user_role;
begin
  if actor is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if not livd_is_moderator() then
    raise exception 'Only a moderator may change an account standing' using errcode = '42501';
  end if;

  if target_user_id = actor then
    raise exception 'You cannot change your own standing' using errcode = '42501';
  end if;

  if change_reason is null or char_length(btrim(change_reason)) < 3 then
    raise exception 'A reason is required, for the audit trail' using errcode = '22023';
  end if;

  select status, role into previous, target_role
  from profiles where id = target_user_id for update;

  if previous is null then
    raise exception 'No such account' using errcode = 'P0002';
  end if;

  if target_role in ('moderator', 'trust_admin', 'admin') and not livd_is_super_admin() then
    raise exception 'Only an administrator may act on a privileged account'
      using errcode = '42501';
  end if;

  if new_status = 'suspended' and not livd_is_trust_admin() then
    raise exception 'Suspending an account requires Trust and Safety authorisation'
      using errcode = '42501';
  end if;

  if previous = new_status then
    return;
  end if;

  perform set_config('livd.privileged_write', 'on', true);
  update profiles set status = new_status where id = target_user_id;
  perform set_config('livd.privileged_write', 'off', true);

  insert into moderation_actions
    (actor_id, subject_type, subject_id, action, reason, previous_status, new_status)
  values
    (actor, 'user', target_user_id, 'status_changed', btrim(change_reason),
     previous::text, new_status::text);
end;
$$;

revoke execute on function livd_set_user_role(uuid, user_role, text)     from public, anon;
revoke execute on function livd_set_user_status(uuid, user_status, text) from public, anon;

grant execute on function livd_set_user_role(uuid, user_role, text)      to authenticated;
grant execute on function livd_set_user_status(uuid, user_status, text)  to authenticated;

comment on function livd_set_user_role(uuid, user_role, text) is
  'The only path by which profiles.role may change. Derives the actor from auth.uid(); the caller cannot name one.';
comment on function livd_set_user_status(uuid, user_status, text) is
  'The only path by which profiles.status may change. Derives the actor from auth.uid(); the caller cannot name one.';

-- ---------------------------------------------------------------------------
-- Make the record of all this un-erasable
--
-- `moderation_actions` was append-only by RLS, which sounds like a guarantee
-- and is not one: every administrative write in this application uses the
-- service-role client, and the service role bypasses RLS entirely. An
-- administrator who escalated themselves could have deleted the row saying so.
--
-- A trigger binds regardless of role, so now they cannot. The grants are
-- withdrawn as well, so the attempt fails before the trigger is reached.
-- ---------------------------------------------------------------------------

create or replace function livd_forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only; rows cannot be changed or removed', tg_table_name
    using errcode = '42501';
end;
$$;

revoke execute on function livd_forbid_mutation() from public, anon, authenticated;

drop trigger if exists moderation_actions_append_only on moderation_actions;

create trigger moderation_actions_append_only
  before update or delete on moderation_actions
  for each row execute function livd_forbid_mutation();

revoke update, delete, truncate on table moderation_actions
  from anon, authenticated, service_role;

comment on table moderation_actions is
  'Append-only, enforced by trigger rather than by policy: RLS does not bind the service role, and every administrative write in this application uses it.';
