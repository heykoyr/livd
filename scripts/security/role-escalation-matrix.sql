-- ===========================================================================
-- Livd — privilege escalation, tested against the database as each role
--
-- Run this against the production project. It commits nothing: the final
-- RAISE aborts the transaction, so the two promotions it performs and any
-- escalation it manages to achieve are rolled back. The results come back in
-- the error message.
--
--     supabase db query < scripts/security/role-escalation-matrix.sql
--     -- or paste into the SQL editor
--
-- Every line should read "(expected)". Anything reading "(BUG)" is a live
-- privilege escalation and is a stop-everything event.
--
-- WHY IT EXISTS
--
-- `http-postgrest.mjs` already fires the headline attack —
-- `PATCH /rest/v1/profiles {"role":"admin"}` — over real HTTP, and it is the
-- better test for what an outsider can reach, because it crosses the same
-- wire they would. But it holds the anon key, so every request it makes is
-- anonymous, and the attacker this file exists for is not anonymous: they are
-- a moderator Livd has *deliberately* given an account to.
--
-- That is the threat the escalation bug was. Until migration 0020 a moderator
-- could `PATCH` themselves to `admin` from a browser, because
-- `profiles_moderator_update` was written `for update using
-- (livd_is_moderator())` with no `with check` — so Postgres reused the `using`
-- expression as the check and allowed any new value. No amount of anonymous
-- probing finds that. You have to be signed in as the moderator.
--
-- So this simulates the session instead of holding one: `set local role
-- authenticated` plus a `request.jwt.claims` naming the actor is exactly what
-- PostgREST does per request, which means these attacks run against the same
-- grants, the same policies and the same triggers as a real one, without
-- anybody having to hold a moderator's credentials to run the suite.
--
-- Nothing needs editing before running. It picks its own accounts.
-- ===========================================================================

do $$
declare
  mod_id    uuid;   -- promoted to moderator inside this transaction
  trust_id  uuid;   -- promoted to trust_admin inside this transaction
  res_id    uuid;   -- an ordinary resident
  victim_id uuid;   -- somebody else's account, the target of a lateral attack
  own_id    uuid;   -- a property owner
  out       text := '';
  n         int;
  err       text;

  -- A result line. `blocked` is the expected outcome everywhere except the
  -- control, so the verdict is computed rather than written out each time.
  procedure_note text;
begin
  select id into mod_id    from profiles where role = 'resident' and status = 'active' order by id offset 0 limit 1;
  select id into trust_id  from profiles where role = 'resident' and status = 'active' order by id offset 1 limit 1;
  select id into res_id    from profiles where role = 'resident' and status = 'active' order by id offset 2 limit 1;
  select id into victim_id from profiles where role = 'resident' and status = 'active' order by id offset 3 limit 1;
  select id into own_id    from profiles where role = 'owner'    and status = 'active' limit 1;

  if mod_id is null or trust_id is null or res_id is null or victim_id is null then
    raise exception 'Need at least four active resident accounts to run this matrix';
  end if;

  -- The promotions go through the same privileged gate the RPCs use. Rolled
  -- back with everything else.
  perform set_config('livd.privileged_write', 'on', true);
  update profiles set role = 'moderator'   where id = mod_id;
  update profiles set role = 'trust_admin' where id = trust_id;
  perform set_config('livd.privileged_write', 'off', true);

  out := out || E'\n--- As a moderator ---------------------------------------------\n';

  /* ---- 1. The original exploit: promote yourself ---------------------- */
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims = %L',
                   json_build_object('sub', mod_id, 'role', 'authenticated')::text);
    update profiles set role = 'admin' where id = mod_id;
    get diagnostics n = row_count;
    reset role;
    out := out || format(E'  promote self to admin ............... %s\n',
      case when n > 0 then '(BUG) ESCALATED' else '(expected) blocked' end);
  exception when others then
    reset role; get stacked diagnostics err = message_text;
    out := out || format(E'  promote self to admin ............... (expected) %s\n', err);
  end;

  /* ---- 2. Sideways: promote somebody else ---------------------------- */
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims = %L',
                   json_build_object('sub', mod_id, 'role', 'authenticated')::text);
    update profiles set role = 'admin' where id = victim_id;
    get diagnostics n = row_count;
    reset role;
    out := out || format(E'  promote another account ............. %s\n',
      case when n > 0 then '(BUG) ESCALATED' else '(expected) blocked' end);
  exception when others then
    reset role; get stacked diagnostics err = message_text;
    out := out || format(E'  promote another account ............. (expected) %s\n', err);
  end;

  /* ---- 3. Through the front door, which has its own check ------------ */
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims = %L',
                   json_build_object('sub', mod_id, 'role', 'authenticated')::text);
    perform livd_set_user_role(victim_id, 'admin', 'escalation attempt');
    reset role;
    out := out || E'  livd_set_user_role .................. (BUG) ESCALATED\n';
  exception when others then
    reset role; get stacked diagnostics err = message_text;
    out := out || format(E'  livd_set_user_role .................. (expected) %s\n', err);
  end;

  /* ---- 4. Forge the privileged flag the trigger reads ----------------
     The trigger opens on `livd.privileged_write`. If a caller could set that
     GUC themselves the whole gate would be decorative, so it is worth firing
     at directly rather than reasoning about. */
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims = %L',
                   json_build_object('sub', mod_id, 'role', 'authenticated')::text);
    perform set_config('livd.privileged_write', 'on', true);
    update profiles set role = 'admin' where id = mod_id;
    get diagnostics n = row_count;
    reset role;
    out := out || format(E'  forge livd.privileged_write ......... %s\n',
      case when n > 0 then '(BUG) ESCALATED' else '(expected) blocked' end);
  exception when others then
    reset role; get stacked diagnostics err = message_text;
    out := out || format(E'  forge livd.privileged_write ......... (expected) %s\n', err);
  end;

  out := out || E'\n--- As a trust admin -------------------------------------------\n';

  /* ---- 5. The second-highest rank reaching for the highest ----------- */
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims = %L',
                   json_build_object('sub', trust_id, 'role', 'authenticated')::text);
    perform livd_set_user_role(trust_id, 'admin', 'self promote');
    reset role;
    out := out || E'  promote self via RPC ................ (BUG) ESCALATED\n';
  exception when others then
    reset role; get stacked diagnostics err = message_text;
    out := out || format(E'  promote self via RPC ................ (expected) %s\n', err);
  end;

  out := out || E'\n--- As an ordinary account -------------------------------------\n';

  /* ---- 6. A resident editing their own row --------------------------- */
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims = %L',
                   json_build_object('sub', res_id, 'role', 'authenticated')::text);
    update profiles set role = 'admin' where id = res_id;
    get diagnostics n = row_count;
    reset role;
    out := out || format(E'  resident sets own role .............. %s\n',
      case when n > 0 then '(BUG) ESCALATED' else '(expected) blocked' end);
  exception when others then
    reset role; get stacked diagnostics err = message_text;
    out := out || format(E'  resident sets own role .............. (expected) %s\n', err);
  end;

  /* ---- 7. An owner, who is the party a reviewer needs protecting from */
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims = %L',
                   json_build_object('sub', own_id, 'role', 'authenticated')::text);
    update profiles set role = 'admin' where id = own_id;
    get diagnostics n = row_count;
    reset role;
    out := out || format(E'  owner sets own role ................. %s\n',
      case when n > 0 then '(BUG) ESCALATED' else '(expected) blocked' end);
  exception when others then
    reset role; get stacked diagnostics err = message_text;
    out := out || format(E'  owner sets own role ................. (expected) %s\n', err);
  end;

  /* ---- 8. Re-creating your own profile row as an admin ---------------
     RLS has no INSERT policy on `profiles`, which denies by default — but
     `authenticated` *is* granted INSERT on the `role` column, so the denial
     rests entirely on the missing policy. Worth firing at rather than
     assuming. */
  begin
    perform set_config('livd.privileged_write', 'on', true);
    delete from profiles where id = victim_id;
    perform set_config('livd.privileged_write', 'off', true);

    execute 'set local role authenticated';
    execute format('set local request.jwt.claims = %L',
                   json_build_object('sub', victim_id, 'role', 'authenticated')::text);
    insert into profiles (id, role, status, preferred_locale, reputation)
    values (victim_id, 'admin', 'active', 'en', 0);
    get diagnostics n = row_count;
    reset role;
    out := out || format(E'  re-insert own profile as admin ...... %s\n',
      case when n > 0 then '(BUG) ESCALATED' else '(expected) blocked' end);
  exception when others then
    reset role; get stacked diagnostics err = message_text;
    out := out || format(E'  re-insert own profile as admin ...... (expected) %s\n', err);
  end;

  out := out || E'\n--- Control ----------------------------------------------------\n';

  /* ---- 9. The legitimate write must still work -----------------------
     Without this the whole file could pass by having broken `profiles`
     outright, which is a failure mode every deny-list test has and very few
     check for. */
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims = %L',
                   json_build_object('sub', res_id, 'role', 'authenticated')::text);
    update profiles set email_review_updates = not email_review_updates where id = res_id;
    get diagnostics n = row_count;
    reset role;
    out := out || format(E'  resident edits own preferences ...... %s\n',
      case when n > 0 then '(expected) allowed' else '(BUG) BROKEN — legitimate write refused' end);
  exception when others then
    reset role; get stacked diagnostics err = message_text;
    out := out || format(E'  resident edits own preferences ...... (BUG) BROKEN — %s\n', err);
  end;

  reset role;
  raise exception E'ROLE ESCALATION MATRIX (nothing committed)\n%', out;
end $$;
