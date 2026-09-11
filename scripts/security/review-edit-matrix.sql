-- ===========================================================================
-- Livd — the review correction matrix, against the live database
--
-- The counterpart to `tests/safety/review-editing.test.ts`. That suite runs
-- against the local adapter, which has no privilege system; this one runs as
-- `authenticated` and as `anon` against the real thing, where RLS, the column
-- grants, the update guard and `livd_correct_review` all apply.
--
-- Neither can cover both. A rule that holds in one and not the other is the
-- failure this pair exists to find.
--
-- It commits nothing. The final `raise` aborts the transaction and the results
-- come back in the error message — the same shape as
-- `owner-response-matrix.sql`, and for the same reason: a security check that
-- leaves rows behind is one nobody will run twice.
--
-- USAGE
--
--   supabase db query < scripts/security/review-edit-matrix.sql
--
-- or paste it into the SQL editor. It picks its own fixtures: a published
-- review inside the window, one outside it, and an account that wrote neither.
-- If it reports `no fixture`, seed a review and run it again.
-- ===========================================================================

do $$
declare
  fresh_id   uuid;
  fresh_body text;
  fresh_rec  boolean;
  author     uuid;
  stale_id   uuid;
  stale_by   uuid;
  stranger   uuid;
  report     text := '';
  outcome    timestamptz;

  -- Long enough to clear the 40-character minimum, so a refusal is never
  -- the length rule wearing an authorisation rule's clothes.
  new_body   text := 'A corrected body, written to be comfortably past the minimum length.';
begin
  /* --- Fixtures ---------------------------------------------------- */

  select id, author_id, body, would_recommend
    into fresh_id, author, fresh_body, fresh_rec
    from reviews
   where status = 'published'
     and author_id is not null
     and created_at > now() - interval '24 hours'
   order by created_at desc
   limit 1;

  select id, author_id into stale_id, stale_by
    from reviews
   where status = 'published'
     and author_id is not null
     and created_at <= now() - interval '24 hours'
   order by created_at desc
   limit 1;

  select id into stranger
    from profiles
   where id is distinct from author
   order by created_at
   limit 1;

  if fresh_id is null or stale_id is null or stranger is null then
    raise exception 'no fixture: need a published review inside the window, one outside it, and a second account';
  end if;

  /* --- Case 1 · the author, inside the window --------------------- */

  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', author, 'role', 'authenticated')::text, true);
    set local role authenticated;

    outcome := livd_correct_review(fresh_id, new_body, true);
    report := report || 'case 1  author, in window       : OK — saved, window closes '
                     || outcome || E'\n';
  exception when others then
    report := report || 'case 1  author, in window       : FAIL — ' || sqlerrm || E'\n';
  end;
  reset role;

  /* --- Case 2 · the author, after it closed ----------------------- */

  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', stale_by, 'role', 'authenticated')::text, true);
    set local role authenticated;

    perform livd_correct_review(stale_id, new_body, true);
    report := report || E'case 2  author, expired         : FAIL — the edit was accepted\n';
  exception when others then
    report := report || 'case 2  author, expired         : OK — ' || sqlerrm || E'\n';
  end;
  reset role;

  /* --- Case 3 · somebody else, inside the window ------------------ */

  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
    set local role authenticated;

    perform livd_correct_review(fresh_id, new_body, true);
    report := report || E'case 3  not the author          : FAIL — the edit was accepted\n';
  exception when others then
    report := report || 'case 3  not the author          : OK — ' || sqlerrm || E'\n';
  end;
  reset role;

  /* --- Case 4 · anonymous ----------------------------------------- */

  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;

    perform livd_correct_review(fresh_id, new_body, true);
    report := report || E'case 4  anonymous               : FAIL — the edit was accepted\n';
  exception when others then
    report := report || 'case 4  anonymous               : OK — ' || sqlerrm || E'\n';
  end;
  reset role;

  /* --- Case 5 · naming a review that is not theirs ---------------- */
  -- Same wording as "no such review", deliberately: two distinguishable
  -- refusals would make this function a way to enumerate review ids.

  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', author, 'role', 'authenticated')::text, true);
    set local role authenticated;

    perform livd_correct_review('00000000-0000-0000-0000-000000000000', new_body, true);
    report := report || E'case 5  review that is not mine : FAIL — the edit was accepted\n';
  exception when others then
    report := report || 'case 5  review that is not mine : OK — ' || sqlerrm || E'\n';
  end;
  reset role;

  /* --- Case 6 · a forged clock ------------------------------------ */
  -- `livd_correct_review` takes no timestamp, so the only clock a caller can
  -- reach is the session's own. Moving it does nothing: the comparison is
  -- against `now()`, which is the transaction's start time from the server.

  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', stale_by, 'role', 'authenticated')::text, true);
    set local role authenticated;
    set local timezone = 'Pacific/Kiritimati';

    perform livd_correct_review(stale_id, new_body, true);
    report := report || E'case 6  forged clock            : FAIL — the edit was accepted\n';
  exception when others then
    report := report || 'case 6  forged clock            : OK — ' || sqlerrm || E'\n';
  end;
  reset role;
  reset timezone;

  /* --- Case 7 · extending the window ------------------------------ */

  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', author, 'role', 'authenticated')::text, true);
    set local role authenticated;

    update reviews set created_at = now() where id = fresh_id;
    report := report || E'case 7  extend own window       : FAIL — created_at was writable\n';
  exception when others then
    report := report || 'case 7  extend own window       : OK — ' || sqlerrm || E'\n';
  end;
  reset role;

  /* --- Beyond the seven ------------------------------------------- */
  -- What a correction must not be able to reach, tried directly rather than
  -- through the function. Each value genuinely differs from the one stored, so
  -- a "permitted" here is a permitted and not a no-op update.

  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', author, 'role', 'authenticated')::text, true);
    set local role authenticated;

    begin
      update reviews set overall_rating = 6 - overall_rating where id = fresh_id;
      report := report || E'extra   rewrite the rating      : FAIL — writable\n';
    exception when others then
      report := report || 'extra   rewrite the rating      : OK — ' || sqlerrm || E'\n';
    end;

    -- An array literal, not a bare string. Spelt wrong the first time this was
    -- run, and `malformed array literal` reported itself as a passing control.
    -- A check that cannot tell a refusal from a syntax error is not a check.
    begin
      update reviews set safety_flags = safety_flags || array['fabricated'] where id = fresh_id;
      report := report || E'extra   edit the safety flags   : FAIL — writable\n';
    exception when others then
      report := report || 'extra   edit the safety flags   : OK — ' || sqlerrm || E'\n';
    end;

    begin
      update reviews set rent_amount_minor = 1, rent_currency = 'GBP', rent_period = 'month'
       where id = fresh_id;
      report := report || E'extra   revise the rent         : FAIL — writable\n';
    exception when others then
      report := report || 'extra   revise the rent         : OK — ' || sqlerrm || E'\n';
    end;

    begin
      update reviews set tenure_months = tenure_months + 120 where id = fresh_id;
      report := report || E'extra   revise the tenure       : FAIL — writable\n';
    exception when others then
      report := report || 'extra   revise the tenure       : OK — ' || sqlerrm || E'\n';
    end;

    begin
      update reviews set status = 'removed' where id = fresh_id;
      report := report || E'extra   unpublish by hand       : FAIL — writable\n';
    exception when others then
      report := report || 'extra   unpublish by hand       : OK — ' || sqlerrm || E'\n';
    end;

    begin
      update reviews
         set verification_level = case when verification_level = 'verified_resident'
                                       then 'unverified'::verification_level
                                       else 'verified_resident'::verification_level end
       where id = fresh_id;
      report := report || E'extra   award myself a badge    : FAIL — writable\n';
    exception when others then
      report := report || 'extra   award myself a badge    : OK — ' || sqlerrm || E'\n';
    end;

    -- The exemption the correction function uses, forged by hand. A client has
    -- no way to set a GUC outside `request.*` through PostgREST, and each
    -- request is its own transaction — but the exemption is written so that
    -- holding the setting still buys nothing on its own.
    begin
      perform set_config('livd.correction', 'on', true);
      update reviews set overall_rating = 6 - overall_rating where id = fresh_id;
      report := report || E'extra   forged correction GUC   : FAIL — writable\n';
    exception when others then
      report := report || 'extra   forged correction GUC   : OK — ' || sqlerrm || E'\n';
    end;
    perform set_config('livd.correction', 'off', true);

    -- And the thing that must still work.
    begin
      update reviews set body = new_body, would_recommend = not fresh_rec where id = fresh_id;
      report := report || E'extra   correct the words       : OK — permitted\n';
    exception when others then
      report := report || 'extra   correct the words       : FAIL — wrongly refused, ' || sqlerrm || E'\n';
    end;
  end;
  reset role;

  /* --- Anonymous reading what it should not ------------------------ */

  -- RLS filters rows rather than refusing statements, so "it did not throw" is
  -- not an answer here. The reads below count what came back.
  declare
    visible int;
    total   int;
  begin
    select count(*) into total from review_snapshots;

    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;

    -- A column grant, so this one does refuse outright.
    begin
      perform author_id from reviews where id = fresh_id;
      report := report || E'extra   anon reads author_id     : FAIL — readable\n';
    exception when others then
      report := report || 'extra   anon reads author_id     : OK — ' || sqlerrm || E'\n';
    end;

    begin
      select count(*) into visible from review_snapshots;
      report := report || 'extra   anon reads snapshots     : '
                       || case when visible = 0 then 'OK' else 'FAIL' end
                       || ' — ' || visible || ' of ' || total || E' row(s) visible\n';
    exception when others then
      report := report || 'extra   anon reads snapshots     : OK — ' || sqlerrm || E'\n';
    end;

    begin
      select count(*) into visible from moderation_actions;
      report := report || 'extra   anon reads mod trail     : '
                       || case when visible = 0 then 'OK' else 'FAIL' end
                       || ' — ' || visible || E' row(s) visible\n';
    exception when others then
      report := report || 'extra   anon reads mod trail     : OK — ' || sqlerrm || E'\n';
    end;
  end;
  reset role;

  raise exception E'\n=== review correction matrix ===\n\n%\nNothing was committed.', report;
end $$;
