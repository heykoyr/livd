-- ===========================================================================
-- Livd — the owner right of reply, tested against the database
--
-- Run this against the production project. It commits nothing: the final
-- RAISE aborts the transaction, so every insert and update below is rolled
-- back. The results come back in the error message, which is the point — a
-- test that had to commit to report would not be safe to run on a live
-- database, and this one is.
--
--     supabase db query < scripts/security/owner-response-matrix.sql
--     -- or paste into the SQL editor
--
-- WHY IT EXISTS
--
-- "The owner can reply" was implemented three times — a Server Action, an RLS
-- policy, and a UI — and the thing that made it not work was that the three
-- had never been run against each other. Hiding a button is not a control and
-- an untested policy is not a guarantee, so the guarantees are asserted here,
-- at the only layer that can actually refuse.
--
-- BEFORE RUNNING, set the four ids at the top to real rows:
--
--   owner_id   the claimant of an approved claim
--   prop_id    the property that claim is on
--   rev_id     a published review of that property
--   other_rev  a published review of any *other* property
--
--   select c.claimant_id, c.property_id,
--          (select id from reviews r where r.property_id = c.property_id
--             and r.status = 'published' limit 1) as rev_id,
--          (select id from reviews r where r.property_id <> c.property_id
--             and r.status = 'published' limit 1) as other_rev
--     from property_claims c where c.status = 'approved' limit 1;
--
-- Every line of output should read "(expected)". Anything reading "(BUG)" is
-- a live authorisation failure.
-- ===========================================================================

do $$
declare
  owner_id   uuid := '00000000-0000-0000-0000-000000000000';  -- the approved claimant
  prop_id    uuid := '00000000-0000-0000-0000-000000000000';  -- their property
  rev_id     uuid := '00000000-0000-0000-0000-000000000000';  -- a published review of it
  other_rev  uuid := '00000000-0000-0000-0000-000000000000';  -- a published review elsewhere
  resident   uuid;
  stranger   uuid;
  other_prop uuid;
  out text := '';
  n int;
  v text;
begin
  select property_id, author_id into other_prop, stranger from reviews where id = other_rev;
  select author_id into resident from reviews where id = rev_id;

  /* ---- Who may post a response ------------------------------------- */

  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    insert into owner_responses (review_id, property_id, responder_id, body, is_resolution_notice)
    values (rev_id, prop_id, owner_id, 'A test response of at least twenty characters in length.', false);
    out := out || E'\n 1 approved owner, own property .......... ALLOWED (expected)';
  exception when others then
    out := out || E'\n 1 approved owner, own property .......... REFUSED (BUG) ' || left(sqlerrm, 70);
  end;
  reset role;

  -- The role on the response is derived by trigger from the claim, never
  -- accepted from the client. See migration 0045.
  select count(*) into n from owner_responses where review_id = rev_id and respondent_role is not null;
  out := out || E'\n 1b respondent_role derived by trigger ... ' || n::text || ' (expect 1)';

  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    insert into owner_responses (review_id, property_id, responder_id, body, is_resolution_notice)
    values (other_rev, other_prop, owner_id, 'A test response of at least twenty characters in length.', false);
    out := out || E'\n 2 owner of a different property ......... ALLOWED (BUG)';
  exception when others then out := out || E'\n 2 owner of a different property ......... REFUSED (expected)';
  end;
  reset role;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', resident, 'role','authenticated')::text, true);
    insert into owner_responses (review_id, property_id, responder_id, body, is_resolution_notice)
    values (rev_id, prop_id, resident, 'A test response of at least twenty characters in length.', false);
    out := out || E'\n 3 an ordinary resident .................. ALLOWED (BUG)';
  exception when others then out := out || E'\n 3 an ordinary resident .................. REFUSED (expected)';
  end;
  reset role;

  begin
    set local role anon;
    perform set_config('request.jwt.claims', '', true);
    insert into owner_responses (review_id, property_id, responder_id, body, is_resolution_notice)
    values (rev_id, prop_id, owner_id, 'A test response of at least twenty characters in length.', false);
    out := out || E'\n 4 anonymous ............................. ALLOWED (BUG)';
  exception when others then out := out || E'\n 4 anonymous ............................. REFUSED (expected)';
  end;
  reset role;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    insert into owner_responses (review_id, property_id, responder_id, body, is_resolution_notice)
    values (other_rev, prop_id, stranger, 'A test response of at least twenty characters in length.', false);
    out := out || E'\n 5 owner writing as somebody else ........ ALLOWED (BUG)';
  exception when others then out := out || E'\n 5 owner writing as somebody else ........ REFUSED (expected)';
  end;
  reset role;

  -- A right of reply, not a comment thread. Unique index on review_id.
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    insert into owner_responses (review_id, property_id, responder_id, body, is_resolution_notice)
    values (rev_id, prop_id, owner_id, 'A second response, also at least twenty characters long.', false);
    out := out || E'\n 6 a second response, same review ........ ALLOWED (BUG)';
  exception when others then out := out || E'\n 6 a second response, same review ........ REFUSED (expected)';
  end;
  reset role;

  /* ---- What a response does not come with -------------------------- */

  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    update reviews set body = 'rewritten by the property owner' where id = rev_id;
    get diagnostics n = row_count;
    out := out || E'\n 7 owner edits the review ................ rows=' || n::text ||
      case when n = 0 then ' (refused, expected)' else ' (BUG)' end;
  exception when others then out := out || E'\n 7 owner edits the review ................ REFUSED (expected)';
  end;
  reset role;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    update reviews set status = 'removed' where id = rev_id;
    get diagnostics n = row_count;
    out := out || E'\n 8 owner removes the review .............. rows=' || n::text ||
      case when n = 0 then ' (refused, expected)' else ' (BUG)' end;
  exception when others then out := out || E'\n 8 owner removes the review .............. REFUSED (expected)';
  end;
  reset role;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    delete from reviews where id = rev_id;
    get diagnostics n = row_count;
    out := out || E'\n 9 owner deletes the review .............. rows=' || n::text ||
      case when n = 0 then ' (refused, expected)' else ' (BUG)' end;
  exception when others then out := out || E'\n 9 owner deletes the review .............. REFUSED (expected)';
  end;
  reset role;

  -- The correlation key 0040 took away. An owner who could read it could
  -- group every review one person has written, in every building.
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    execute 'select author_id::text from reviews where id = $1' into v using rev_id;
    out := out || E'\n10 owner reads author_id .................. ' || coalesce(v,'null') || ' (BUG)';
  exception when others then out := out || E'\n10 owner reads author_id .................. REFUSED (expected)';
  end;
  reset role;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    perform livd_reveal_user_identity(resident, 'safety', 'authorisation test', null, null);
    out := out || E'\n11 owner reveals the reviewer ............ ALLOWED (BUG)';
  exception when others then out := out || E'\n11 owner reveals the reviewer ............ REFUSED (expected)';
  end;
  reset role;

  /* ---- The notification layer (0044) -------------------------------- */

  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    execute 'select count(*)::text from notification_events' into v;
    out := out || E'\n12 client reads the delivery ledger ...... ' || v || ' (BUG)';
  exception when others then out := out || E'\n12 client reads the delivery ledger ...... REFUSED (expected)';
  end;
  reset role;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    execute 'select email from livd_notification_recipient($1)' into v using owner_id;
    out := out || E'\n13 client resolves an address ............ ' || coalesce(v,'null') || ' (BUG)';
  exception when others then out := out || E'\n13 client resolves an address ............ REFUSED (expected)';
  end;
  reset role;

  begin
    set local role anon;
    perform set_config('request.jwt.claims', '', true);
    execute 'select count(*)::text from livd_notification_staff(1)' into v;
    out := out || E'\n14 anon lists staff addresses ............ ' || v || ' (BUG)';
  exception when others then out := out || E'\n14 anon lists staff addresses ............ REFUSED (expected)';
  end;
  reset role;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    update profiles set email_review_updates = false where id = owner_id;
    get diagnostics n = row_count;
    out := out || E'\n15 own preferences writable .............. rows=' || n::text ||
      case when n = 1 then ' (expected)' else ' (BUG)' end;
  exception when others then out := out || E'\n15 own preferences writable .............. REFUSED (BUG) ' || left(sqlerrm, 60);
  end;
  reset role;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    update profiles set email_review_updates = false where id = resident;
    get diagnostics n = row_count;
    out := out || E'\n16 somebody else''s preferences .......... rows=' || n::text ||
      case when n = 0 then ' (refused, expected)' else ' (BUG)' end;
  exception when others then out := out || E'\n16 somebody else''s preferences .......... REFUSED (expected)';
  end;
  reset role;

  -- 0044 widened the column grant on `profiles`. 0020's guarantee must survive it.
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    update profiles set role = 'admin' where id = owner_id;
    out := out || E'\n17 self role escalation .................. ALLOWED (BUG)';
  exception when others then out := out || E'\n17 self role escalation .................. REFUSED (expected)';
  end;
  reset role;

  -- Aborts the transaction. Nothing above is committed.
  raise exception E'\n\n=== OWNER RESPONSE AUTHORISATION MATRIX ===%\n', out;
end $$;
