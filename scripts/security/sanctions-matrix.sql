-- ===========================================================================
-- Livd — sanctions, standing and the append-only record, against the live database
--
-- The counterpart to `tests/safety/sanctions.test.ts` and
-- `tests/safety/standing-enforcement.test.ts`. Those run against the local
-- adapter, which has no privilege system; this runs as `authenticated` against
-- the real grants, policies, triggers and functions.
--
-- It commits nothing. Every case runs in its own subtransaction and is rolled
-- back when it finishes, and the final `raise` aborts the whole transaction, so
-- the promotions, the fixture review, the sanctions and the account deletion it
-- performs all disappear. The results come back in the error message.
--
--     supabase db query < scripts/security/sanctions-matrix.sql
--     -- or paste into the SQL editor
--
-- Every line should read "(expected)". "(BUG)" is a live finding.
--
-- WHAT IT COVERS — the findings migration 0050 closed:
--
--   1–3  the sanction ladder: a moderator banning or un-banning through
--        `livd_set_user_status`, and a lighter sanction overwriting a ban
--   4–6  a banned author rewriting a review inside its window
--   7    a correction to the category ratings alone leaving no snapshot
--   8    deleting an account that the append-only record refers to
--   9–10 forging an audit entry through `livd_record_admin_audit`
--   11   the sanctioned person reading a moderator's internal note
--   12   a ban notice having nobody to go to
--   13–15 controls: the legitimate writes still work
--
-- It picks its own accounts: five active residents.
-- ===========================================================================

do $$
declare
  mod_id    uuid;
  trust_id  uuid;
  admin_id  uuid;
  victim_id uuid;
  author_id uuid;
  prop_id   uuid;
  cat_key   text;
  fixture_review uuid;
  out       text := '';
  verdict   text;
  n         int;
  s         user_status;
  j         jsonb;
  body_text text := 'A fixture review body, long enough to clear the forty character minimum.';

  -- A case ends by raising this, which rolls its subtransaction back.
  done constant text := 'livd-matrix-case-done';
begin
  select id into mod_id    from profiles where role = 'resident' and status = 'active' order by id offset 0 limit 1;
  select id into trust_id  from profiles where role = 'resident' and status = 'active' order by id offset 1 limit 1;
  select id into admin_id  from profiles where role = 'resident' and status = 'active' order by id offset 2 limit 1;
  select id into victim_id from profiles where role = 'resident' and status = 'active' order by id offset 3 limit 1;
  select id into author_id from profiles where role = 'resident' and status = 'active' order by id offset 4 limit 1;
  select id into prop_id   from properties where status = 'active' order by id limit 1;
  select key into cat_key  from review_category_defs order by key limit 1;

  if author_id is null or prop_id is null or cat_key is null then
    raise exception 'Need five active resident accounts, an active property and a rating category';
  end if;

  -- Rolled back with everything else.
  perform set_config('livd.privileged_write', 'on', true);
  update profiles set role = 'moderator'   where id = mod_id;
  update profiles set role = 'trust_admin' where id = trust_id;
  update profiles set role = 'admin'       where id = admin_id;
  perform set_config('livd.privileged_write', 'off', true);

  -- A published review inside its correction window, with one category rating.
  -- 1990 keeps it clear of the one-review-per-tenancy index.
  insert into reviews
    (property_id, author_id, residency_status, moved_in_month, tenure_months,
     overall_rating, would_recommend, body)
  values
    (prop_id, author_id, 'current', date '1990-01-01', 12, 3, true, body_text)
  returning id into fixture_review;

  insert into review_category_ratings (review_id, category_key, rating)
  values (fixture_review, cat_key, 2);

  out := out || E'\n--- The sanction ladder -----------------------------------------\n';

  /* ---- 1. A moderator bans through the old status path --------------- */
  verdict := null;
  begin
    begin
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', mod_id, 'role', 'authenticated')::text, true);
      perform livd_set_user_status(victim_id, 'banned', 'moderator attempting a ban');
      reset role;
    exception when others then
      verdict := '(expected) ' || sqlerrm;
    end;
    reset role;
    if verdict is null then
      select status into s from profiles where id = victim_id;
      verdict := case when s = 'banned' then '(BUG) the moderator banned the account' else '(expected) not banned' end;
    end if;
    raise exception '%', done;
  exception when others then
    if sqlerrm <> done then verdict := '(ERROR) ' || sqlerrm; end if;
  end;
  out := out || format(E'  1  moderator bans via set_user_status ..... %s\n', verdict);

  /* ---- 2. A moderator lifts a ban through the old status path -------- */
  verdict := null;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform livd_apply_sanction(victim_id, 'banned', 'threats', 'Fixture ban for the matrix');
    reset role;

    begin
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', mod_id, 'role', 'authenticated')::text, true);
      perform livd_set_user_status(victim_id, 'active', 'moderator attempting to un-ban');
      reset role;
    exception when others then
      verdict := '(expected) ' || sqlerrm;
    end;
    reset role;
    if verdict is null then
      select status into s from profiles where id = victim_id;
      verdict := case when s = 'banned' then '(expected) still banned' else '(BUG) the ban was lifted, standing now ' || s end;
    end if;
    raise exception '%', done;
  exception when others then
    if sqlerrm <> done then verdict := '(ERROR) ' || sqlerrm; end if;
  end;
  out := out || format(E'  2  moderator un-bans via set_user_status .. %s\n', verdict);

  /* ---- 3. A restriction applied on top of a ban ---------------------- */
  verdict := null;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform livd_apply_sanction(victim_id, 'banned', 'threats', 'Fixture ban for the matrix');
    reset role;

    begin
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', mod_id, 'role', 'authenticated')::text, true);
      perform livd_apply_sanction(victim_id, 'restricted', 'spam', 'A lighter sanction on a banned account', 7);
      reset role;
    exception when others then
      verdict := '(expected) refused: ' || sqlerrm;
    end;
    reset role;
    if verdict is null then
      select status into s from profiles where id = victim_id;
      verdict := case when s = 'banned' then '(expected) recorded, account still banned'
                      else '(BUG) the restriction replaced the ban, standing now ' || s end;
    end if;
    raise exception '%', done;
  exception when others then
    if sqlerrm <> done then verdict := '(ERROR) ' || sqlerrm; end if;
  end;
  out := out || format(E'  3  restriction on top of a ban ............ %s\n', verdict);

  out := out || E'\n--- A banned author -----------------------------------------------\n';

  /* ---- 4. livd_correct_review ---------------------------------------- */
  verdict := null;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform livd_apply_sanction(author_id, 'banned', 'threats', 'Fixture ban for the matrix');
    reset role;

    begin
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', author_id, 'role', 'authenticated')::text, true);
      perform livd_correct_review(fixture_review, body_text || ' Rewritten after the ban.', true);
      reset role;
      verdict := '(BUG) a banned author rewrote their review';
    exception when others then
      verdict := '(expected) ' || sqlerrm;
    end;
    reset role;
    raise exception '%', done;
  exception when others then
    if sqlerrm <> done then verdict := '(ERROR) ' || sqlerrm; end if;
  end;
  out := out || format(E'  4  correct_review while banned ............ %s\n', verdict);

  /* ---- 5. PATCH the body directly ------------------------------------ */
  verdict := null;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform livd_apply_sanction(author_id, 'banned', 'threats', 'Fixture ban for the matrix');
    reset role;

    begin
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', author_id, 'role', 'authenticated')::text, true);
      update reviews set body = body_text || ' Patched after the ban.' where id = fixture_review;
      get diagnostics n = row_count;
      reset role;
      verdict := case when n > 0 then '(BUG) a banned author patched their review' else '(expected) no row updated' end;
    exception when others then
      verdict := '(expected) ' || sqlerrm;
    end;
    reset role;
    raise exception '%', done;
  exception when others then
    if sqlerrm <> done then verdict := '(ERROR) ' || sqlerrm; end if;
  end;
  out := out || format(E'  5  direct UPDATE while banned ............. %s\n', verdict);

  /* ---- 6. Add a rating to the review directly ------------------------ */
  verdict := null;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform livd_apply_sanction(author_id, 'suspended', 'harassment', 'Fixture suspension for the matrix', 7);
    reset role;

    begin
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', author_id, 'role', 'authenticated')::text, true);
      insert into review_tags (review_id, tag_key)
        select fixture_review, d.key from review_tag_defs d order by d.key limit 1;
      get diagnostics n = row_count;
      reset role;
      verdict := case when n > 0 then '(BUG) a suspended author added to their review' else '(expected) nothing inserted' end;
    exception when others then
      verdict := '(expected) ' || sqlerrm;
    end;
    reset role;
    raise exception '%', done;
  exception when others then
    if sqlerrm <> done then verdict := '(ERROR) ' || sqlerrm; end if;
  end;
  out := out || format(E'  6  child-table INSERT while suspended ..... %s\n', verdict);

  out := out || E'\n--- Evidence and the record --------------------------------------\n';

  /* ---- 7. A correction to the category ratings alone ----------------- */
  verdict := null;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', author_id, 'role', 'authenticated')::text, true);
    perform livd_correct_review(
      fixture_review, body_text, true, '{}', false, null,
      jsonb_build_array(jsonb_build_object('categoryKey', cat_key, 'rating', 5))
    );
    reset role;

    select count(*) into n from review_snapshots
     where review_snapshots.review_id = fixture_review
       and category_ratings @> jsonb_build_array(jsonb_build_object('categoryKey', cat_key, 'rating', 2));

    verdict := case when n > 0 then '(expected) the published ratings were preserved'
                    else '(BUG) the original rating is gone and no snapshot kept it' end;
    raise exception '%', done;
  exception when others then
    if sqlerrm <> done then verdict := '(ERROR) ' || sqlerrm; end if;
  end;
  out := out || format(E'  7  ratings-only correction ................ %s\n', verdict);

  /* ---- 8. Deleting an account the record refers to ------------------- */
  verdict := null;
  begin
    -- Give the author a footprint in every append-only table a resident can
    -- reach: a correction (snapshot), a held correction (moderation trail), a
    -- refused admin attempt (audit log) and a sanction.
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', author_id, 'role', 'authenticated')::text, true);
    perform livd_correct_review(fixture_review, body_text || ' Corrected once.', true, array['allegation'], true);
    perform livd_record_admin_audit('identity_revealed', 'user', victim_id, 'denied');
    reset role;

    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', mod_id, 'role', 'authenticated')::text, true);
    perform livd_apply_sanction(author_id, 'restricted', 'spam', 'Fixture restriction for the matrix', 3);
    reset role;

    begin
      delete from auth.users where id = author_id;
      select
        (select count(*) from review_snapshots where changed_by is null and review_snapshots.review_id = fixture_review)
        + (select count(*) from user_sanctions where user_id is null and reason = 'Fixture restriction for the matrix')
        into n;
      verdict := case when n >= 2 then '(expected) deleted; the record stays, unattributed'
                      else '(BUG) deleted, but the record went with it (' || n || ' rows kept)' end;
    exception when others then
      verdict := '(BUG) deletion refused: ' || sqlerrm;
    end;
    raise exception '%', done;
  exception when others then
    if sqlerrm <> done then verdict := '(ERROR) ' || sqlerrm; end if;
  end;
  out := out || format(E'  8  delete an account with a record ........ %s\n', verdict);

  /* ---- 9. A resident forges a reveal in somebody's access history ---- */
  verdict := null;
  begin
    begin
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', author_id, 'role', 'authenticated')::text, true);
      perform livd_record_admin_audit('identity_revealed', 'user', victim_id, 'succeeded', 'forged');
      reset role;
      verdict := '(BUG) a resident wrote a succeeded identity_revealed entry';
    exception when others then
      verdict := '(expected) ' || sqlerrm;
    end;
    reset role;
    raise exception '%', done;
  exception when others then
    if sqlerrm <> done then verdict := '(ERROR) ' || sqlerrm; end if;
  end;
  out := out || format(E'  9  resident forges identity_revealed ...... %s\n', verdict);

  /* ---- 10. A moderator forges a sanction entry ----------------------- */
  verdict := null;
  begin
    begin
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', mod_id, 'role', 'authenticated')::text, true);
      perform livd_record_admin_audit('user_sanctioned', 'user', victim_id, 'succeeded', 'forged');
      reset role;
      verdict := '(BUG) a moderator wrote a sanction entry with no sanction';
    exception when others then
      verdict := '(expected) ' || sqlerrm;
    end;
    reset role;
    raise exception '%', done;
  exception when others then
    if sqlerrm <> done then verdict := '(ERROR) ' || sqlerrm; end if;
  end;
  out := out || format(E'  10 moderator forges user_sanctioned ...... %s\n', verdict);

  out := out || E'\n--- What the sanctioned person receives ---------------------------\n';

  /* ---- 11. The internal note ----------------------------------------- */
  verdict := null;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', mod_id, 'role', 'authenticated')::text, true);
    perform livd_apply_sanction(victim_id, 'restricted', 'spam', 'INTERNAL: matched the reporter in flat 4', 7);
    reset role;

    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', victim_id, 'role', 'authenticated')::text, true);
    select to_jsonb(m) into j from livd_my_sanctions() m limit 1;
    reset role;

    verdict := case
      when j is null then '(ERROR) no sanction returned'
      when j::text like '%INTERNAL%' then '(BUG) the moderator''s note reaches the sanctioned person'
      else '(expected) category and dates only' end;
    raise exception '%', done;
  exception when others then
    if sqlerrm <> done then verdict := '(ERROR) ' || sqlerrm; end if;
  end;
  out := out || format(E'  11 livd_my_sanctions ...................... %s\n', verdict);

  /* ---- 12. The ban notice has somewhere to go ------------------------ */
  verdict := null;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    perform livd_apply_sanction(victim_id, 'banned', 'threats', 'Fixture ban for the matrix');
    reset role;

    select count(*) into n from livd_notification_recipient(victim_id);
    verdict := case when n = 1 then '(expected) the banned account can be told'
                    else '(BUG) no recipient, so a ban can never be explained' end;
    raise exception '%', done;
  exception when others then
    if sqlerrm <> done then verdict := '(ERROR) ' || sqlerrm; end if;
  end;
  out := out || format(E'  12 notification recipient when banned .... %s\n', verdict);

  out := out || E'\n--- Controls: the legitimate writes --------------------------------\n';

  /* ---- 13. Moderator restricts, and lifts ---------------------------- */
  verdict := null;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', mod_id, 'role', 'authenticated')::text, true);
    perform livd_set_user_status(victim_id, 'restricted', 'control: restrict');
    select status into s from profiles where id = victim_id;
    perform livd_set_user_status(victim_id, 'active', 'control: restore');
    reset role;
    verdict := case when s = 'restricted' and (select status from profiles where id = victim_id) = 'active'
                    then '(expected) allowed' else '(BUG) the control failed' end;
    raise exception '%', done;
  exception when others then
    if sqlerrm <> done then verdict := '(BUG) refused: ' || sqlerrm; end if;
  end;
  out := out || format(E'  13 moderator restricts and restores ...... %s\n', verdict);

  /* ---- 14. Lifting a ban falls back to the strongest remaining ------- */
  verdict := null;
  declare
    ban_id uuid;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', mod_id, 'role', 'authenticated')::text, true);
    perform livd_apply_sanction(victim_id, 'restricted', 'spam', 'Control restriction', 7);
    reset role;

    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    ban_id := livd_apply_sanction(victim_id, 'banned', 'threats', 'Control ban');
    perform livd_lift_sanction(ban_id, 'Control: lifted on appeal');
    reset role;

    select status into s from profiles where id = victim_id;
    verdict := case when s = 'restricted' then '(expected) back to restricted'
                    else '(BUG) standing is ' || s end;
    raise exception '%', done;
  exception when others then
    if sqlerrm <> done then verdict := '(BUG) refused: ' || sqlerrm; end if;
  end;
  out := out || format(E'  14 lift ban, restriction remains ........ %s\n', verdict);

  /* ---- 15. An active author still corrects their review -------------- */
  verdict := null;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', author_id, 'role', 'authenticated')::text, true);
    perform livd_correct_review(fixture_review, body_text || ' A legitimate correction.', true);
    reset role;
    verdict := '(expected) allowed';
    raise exception '%', done;
  exception when others then
    if sqlerrm <> done then verdict := '(BUG) refused: ' || sqlerrm; end if;
  end;
  out := out || format(E'  15 active author corrects their review ... %s\n', verdict);

  raise exception E'\n=== sanctions matrix ===\n%\nNothing was committed.', out;
end $$;
