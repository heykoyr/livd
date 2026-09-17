-- ===========================================================================
-- Livd — 0050 · Standing that holds, and a record that lets a person leave
--
-- Found by the Trust & Safety audit of 17 September 2026, and every finding
-- below was reproduced against the live database before anything here was
-- written. `scripts/security/sanctions-matrix.sql` is that reproduction; before
-- this migration it reported twelve (BUG) lines out of fifteen.
--
-- 1. THE SANCTION LADDER HAD TWO SIDE DOORS
--
--    Restrict is a moderator's, suspend is Trust & Safety's, ban is an
--    administrator's — 0032 built that, in both directions. Two things walked
--    around it.
--
--    `livd_set_user_status` is granted to `authenticated` and predates the
--    `banned` value (0031). Its only severity check is for `suspended`. So a
--    moderator, calling it over PostgREST with their own session, could ban an
--    account, or return a banned or suspended one to `active`, with no
--    sanction record. Nothing in the console calls it any more, which is why
--    nobody noticed; the RPC was still there.
--
--    `livd_apply_sanction` set `profiles.status` to whatever was just applied.
--    A moderator restricting a banned account for seven days therefore
--    un-banned it — the restriction replaced the ban, and when it expired the
--    account was simply active. `livd_lift_sanction` and the expiry job already
--    computed the strongest sanction still standing; applying one did not.
--
-- 2. A BANNED AUTHOR COULD STILL REWRITE THEIR REVIEW
--
--    Every INSERT policy asks `livd_is_active_user()`. The correction path
--    does not: `reviews_update_own`, `livd_correct_review` and the child-table
--    predicate from 0048 all ask whether the review is yours, published and
--    inside its window — never whether you are still in good standing. A
--    person banned for what they wrote could spend the rest of the window
--    rewriting it.
--
-- 3. A RATINGS-ONLY CORRECTION WAS NOT PRESERVED
--
--    `livd_snapshot_review` fires when the body, status, level, overall rating
--    or recommendation moves. 0047 made the category ratings correctable
--    through `livd_correct_review`, which replaces them in a child table the
--    trigger cannot see. A correction that changed only those left the review
--    row as it was, took no snapshot, and deleted the ratings it was published
--    with. For a review under investigation that is evidence gone.
--
-- 4. ACCOUNT DELETION FAILED FOR ANYONE THE RECORD REMEMBERS
--
--    0017 made deletion sever rather than destroy: `SET NULL` on every actor
--    column, so the record survives unattributed. 0020 onwards made those same
--    tables append-only with `livd_forbid_mutation` on UPDATE and DELETE. A
--    foreign key performing SET NULL is an UPDATE — 0018 learnt that about
--    `reviews` — so the two rules collided on nine columns:
--
--      moderation_actions.actor_id    admin_audit_log.actor_id
--      review_snapshots.changed_by    case_events.actor_id
--      case_notes.author_id           disclosure_records (three columns)
--      user_sanctions.user_id         (CASCADE into a no-delete trigger)
--
--    Any resident who had corrected a review, had a correction held, been
--    sanctioned, or been refused an admin action could not delete their
--    account. The legal pages promise they can.
--
--    The append-only rule is kept, and taught exactly one transition: a
--    column that points at an account going to null *because that account no
--    longer exists*, with every other column untouched. The existence check is
--    what makes it narrow — no client role holds UPDATE on these tables, and
--    even a role that did could not sever a row whose account is still there.
--
--    `user_sanctions.user_id` becomes SET NULL rather than CASCADE, so a
--    sanction outlives the account the same way a moderation decision does.
--
-- 5. ANYBODY COULD WRITE AN AUDIT ENTRY SAYING ANYTHING
--
--    `livd_record_admin_audit` stamps the actor from the session, so nothing
--    could be forged in somebody else's name. But it accepted any action and
--    any outcome from any signed-in caller. A resident could write a
--    `succeeded` `identity_revealed` entry against any account, and it would
--    appear in that account's identity-access history, which moderators read.
--    A moderator could record a sanction that never happened.
--
--    The application only ever writes two kinds of entry through it: accesses
--    that are not recorded anywhere else (a directory search, a document
--    opened, a case note), and refusals. So: a caller who is not staff may
--    record a refusal or a failure and nothing else, and nobody may record the
--    success of an act the database already records in the same transaction
--    as the act itself.
--
-- 6. WHAT THE SANCTIONED PERSON RECEIVES
--
--    `livd_my_sanctions` returned the moderator's free-text reason — the field
--    the console frames as a note for a colleague "reading this in six
--    months". It now returns the category and its public description instead.
--
--    `livd_notification_recipient` refused banned accounts outright, so a ban
--    could never be explained to the person banned. The rule moves to the
--    dispatcher, which knows what the message is: a banned account receives a
--    decision about its own standing, and nothing else.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1a · livd_set_user_status: the same ladder as a sanction, in both directions
--
-- The tier required is the higher of where the account is and where it is
-- going. Moving a banned account anywhere needs an administrator; so does
-- banning one. Restricting and restoring a restricted account stays a
-- moderator's.
-- ---------------------------------------------------------------------------

create or replace function livd_set_user_status(
  target_user_id uuid,
  new_status     user_status,
  change_reason  text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  actor       uuid := auth.uid();
  previous    user_status;
  target_role user_role;
  required    int;
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

  required := greatest(
    case previous   when 'banned' then 3 when 'suspended' then 2 else 1 end,
    case new_status when 'banned' then 3 when 'suspended' then 2 else 1 end
  );

  if required = 3 and not livd_is_super_admin() then
    raise exception 'Only an administrator may ban an account or lift a ban'
      using errcode = '42501';
  end if;

  if required = 2 and not livd_is_trust_admin() then
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
    (actor_id, actor_role, subject_type, subject_id, action, reason, previous_status, new_status)
  select actor, p.role, 'user', target_user_id, 'status_changed', btrim(change_reason),
         previous::text, new_status::text
  from profiles p where p.id = actor;
end;
$fn$;

comment on function livd_set_user_status(uuid, user_status, text) is
  'Changes profiles.status directly. The tier required is the higher of the current and the new standing: restrict is a moderator''s, suspend is Trust and Safety''s, ban is an administrator''s, in both directions. The console uses livd_apply_sanction; this remains for corrections.';

-- ---------------------------------------------------------------------------
-- 1b · livd_apply_sanction: the account takes the strongest standing sanction
--
-- Unchanged from 0032 except the one line that set the status. A lighter
-- sanction applied on top of a heavier one is still recorded — it may outlast
-- the heavier one — but it no longer replaces it.
-- ---------------------------------------------------------------------------

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
as $fn$
declare
  actor       uuid := auth.uid();
  target_role user_role;
  reason_row  sanction_reason_defs%rowtype;
  new_id      uuid;
  ends        timestamptz;
  standing    user_status;
begin
  if actor is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if sanction_action not in ('restricted', 'suspended', 'banned') then
    raise exception 'That is not a sanction' using errcode = '22023';
  end if;

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

  -- The strongest sanction still standing, which includes the one just written.
  select s.action into standing
  from user_sanctions s
  where s.user_id = target_user_id
    and s.lifted_at is null
    and (s.ends_at is null or s.ends_at > now())
  order by case s.action when 'banned' then 3 when 'suspended' then 2 else 1 end desc
  limit 1;

  perform set_config('livd.privileged_write', 'on', true);
  update profiles set status = coalesce(standing, sanction_action) where id = target_user_id;
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
           'endsAt', ends,
           'standing', coalesce(standing, sanction_action)::text
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
$fn$;

-- ---------------------------------------------------------------------------
-- 2 · Standing binds the correction path
--
-- A trigger rather than three policy edits, so the rule is stated once and
-- binds `reviews_update_own`, `livd_correct_review` (SECURITY DEFINER, so no
-- policy reaches it) and anything added later. It asks one question: is the
-- person changing this review its author, and are they no longer in good
-- standing. Everything else passes straight through — a moderator's decision,
-- somebody else's helpful vote, and the account-deletion foreign key, whose
-- session has no `auth.uid()` at all.
-- ---------------------------------------------------------------------------

create or replace function livd_guard_review_author_standing()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is not null
     and old.author_id = auth.uid()
     and not livd_is_active_user()
     and not livd_is_moderator() then
    raise exception 'This account cannot change its reviews while a restriction is in place'
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;

revoke execute on function livd_guard_review_author_standing() from public, anon, authenticated;

drop trigger if exists reviews_guard_author_standing on reviews;
create trigger reviews_guard_author_standing
  before update on reviews
  for each row execute function livd_guard_review_author_standing();

-- The child-table predicate from 0048 gains the same condition. It is what the
-- insert policies on ratings, tags and departure reasons call.
create or replace function livd_review_is_open_for_me(target_review uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select livd_is_active_user() and exists (
    select 1 from reviews r
    where r.id = target_review
      and r.author_id = auth.uid()
      and r.status = 'published'
      and r.created_at > now() - interval '24 hours'
  );
$fn$;

comment on function livd_review_is_open_for_me(uuid) is
  'Whether the caller may still write facets onto this review: theirs, published, inside the 24-hour correction window, and their account in good standing.';

-- ---------------------------------------------------------------------------
-- 3 · Every correction is preserved, including one to the ratings alone
--
-- `livd_correct_review` sets `livd.correction` before it updates the review
-- row and before it replaces the category ratings, so a snapshot taken here
-- reads the ratings as they were. The rest of the function is 0030's, as it
-- stands.
-- ---------------------------------------------------------------------------

create or replace function livd_snapshot_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.body is distinct from old.body
     or new.status is distinct from old.status
     or new.verification_level is distinct from old.verification_level
     or new.overall_rating is distinct from old.overall_rating
     or new.would_recommend is distinct from old.would_recommend
     -- A correction may replace the category ratings without touching this
     -- row at all. It is snapshotted regardless, because the trigger cannot
     -- see the child table change that is about to happen.
     or coalesce(current_setting('livd.correction', true), '') = 'on' then

    insert into review_snapshots (
      review_id, reason,
      body, overall_rating, would_recommend, residency_status,
      moved_in_month, moved_out_month, tenure_months,
      verification_level, status, safety_flags,
      category_ratings, positive_tags, problem_tags,
      changed_by
    )
    values (
      old.id,
      case
        when new.status is distinct from old.status then 'moderation'
        when new.verification_level is distinct from old.verification_level then 'verification'
        else 'correction'
      end,
      old.body, old.overall_rating, old.would_recommend, old.residency_status,
      old.moved_in_month, old.moved_out_month, old.tenure_months,
      old.verification_level, old.status, old.safety_flags,
      coalesce(
        (select jsonb_agg(jsonb_build_object('categoryKey', cr.category_key, 'rating', cr.rating))
         from review_category_ratings cr where cr.review_id = old.id),
        '[]'::jsonb
      ),
      coalesce(
        (select array_agg(t.tag_key) from review_tags t
         join review_tag_defs d on d.key = t.tag_key
         where t.review_id = old.id and d.polarity = 'positive'),
        '{}'
      ),
      coalesce(
        (select array_agg(t.tag_key) from review_tags t
         join review_tag_defs d on d.key = t.tag_key
         where t.review_id = old.id and d.polarity = 'problem'),
        '{}'
      ),
      auth.uid()
    );
  end if;

  return new;
end;
$fn$;

revoke execute on function livd_snapshot_review() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4 · Append-only, except for the severance an account deletion performs
-- ---------------------------------------------------------------------------

/**
 * Refuses every change to a row, with one exception.
 *
 * The trigger's arguments name the columns that point at an account. Each
 * column that changed must be one of those, must be going from a value to
 * null, and must point at an account that no longer exists. Anything else —
 * a second column moving, a severance while the account is still there, a
 * DELETE — is refused exactly as `livd_forbid_mutation` refuses it.
 */
create or replace function livd_forbid_mutation_except_severance()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  before_row jsonb;
  after_row  jsonb;
  col        text;
  severed    int := 0;
begin
  if tg_op = 'UPDATE' then
    before_row := to_jsonb(old);
    after_row  := to_jsonb(new);

    for col in
      select key from jsonb_each(after_row)
      where after_row -> key is distinct from before_row -> key
    loop
      if not (
        col = any(tg_argv)
        and after_row -> col = 'null'::jsonb
        and before_row -> col <> 'null'::jsonb
        and not exists (select 1 from profiles p where p.id = (before_row ->> col)::uuid)
      ) then
        raise exception '% is append-only; rows cannot be changed or removed', tg_table_name
          using errcode = '42501';
      end if;

      severed := severed + 1;
    end loop;

    if severed > 0 then
      return new;
    end if;
  end if;

  raise exception '% is append-only; rows cannot be changed or removed', tg_table_name
    using errcode = '42501';
end;
$fn$;

revoke execute on function livd_forbid_mutation_except_severance() from public, anon, authenticated;

comment on function livd_forbid_mutation_except_severance() is
  'Append-only, except that a column named in the trigger arguments may go to null when the account it points at has been deleted, with nothing else changing. The account-deletion severance from 0017, and nothing wider.';

drop trigger if exists moderation_actions_append_only on moderation_actions;
create trigger moderation_actions_append_only
  before update or delete on moderation_actions
  for each row execute function livd_forbid_mutation_except_severance('actor_id');

drop trigger if exists admin_audit_log_append_only on admin_audit_log;
create trigger admin_audit_log_append_only
  before update or delete on admin_audit_log
  for each row execute function livd_forbid_mutation_except_severance('actor_id');

drop trigger if exists review_snapshots_append_only on review_snapshots;
create trigger review_snapshots_append_only
  before update or delete on review_snapshots
  for each row execute function livd_forbid_mutation_except_severance('changed_by');

drop trigger if exists case_events_append_only on case_events;
create trigger case_events_append_only
  before update or delete on case_events
  for each row execute function livd_forbid_mutation_except_severance('actor_id');

drop trigger if exists case_notes_append_only on case_notes;
create trigger case_notes_append_only
  before update or delete on case_notes
  for each row execute function livd_forbid_mutation_except_severance('author_id');

drop trigger if exists disclosure_records_append_only on disclosure_records;
create trigger disclosure_records_append_only
  before update or delete on disclosure_records
  for each row execute function
    livd_forbid_mutation_except_severance('subject_user_id', 'authorised_by', 'recorded_by');

-- A sanction outlives the account, unattributed, like the decision that made it.
alter table user_sanctions alter column user_id drop not null;
alter table user_sanctions drop constraint if exists user_sanctions_user_id_fkey;
alter table user_sanctions add constraint user_sanctions_user_id_fkey
  foreign key (user_id) references profiles(id) on delete set null;

comment on column user_sanctions.user_id is
  'The sanctioned account. Null once that account is deleted: the sanction stays, unattributed, as the moderation record does since 0017.';

-- ---------------------------------------------------------------------------
-- 5 · What may be written through livd_record_admin_audit
-- ---------------------------------------------------------------------------

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
as $fn$
declare
  actor uuid := auth.uid();
  role_now user_role;
  new_id bigint;
  effective_outcome text := coalesce(outcome, 'succeeded');
begin
  if actor is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select role into role_now from profiles where id = actor;
  if role_now is null then
    raise exception 'No such account' using errcode = 'P0002';
  end if;

  -- Somebody who is not staff has nothing to record but a refusal: an attempt
  -- at an administrative act that was not theirs to make.
  if effective_outcome = 'succeeded' and not livd_is_moderator() then
    raise exception 'Only staff may record a completed administrative action'
      using errcode = '42501';
  end if;

  -- These are written by the function that performs the act, in the same
  -- transaction as the act. A success recorded here would describe something
  -- that did not happen.
  if effective_outcome = 'succeeded' and audit_action in (
    'identity_revealed', 'user_sanctioned', 'user_sanction_lifted',
    'user_role_changed', 'user_status_changed',
    'authority_request_created', 'authority_request_updated', 'disclosure_recorded',
    'review_status_changed', 'review_verification_changed', 'report_resolved',
    'property_claim_decided', 'verification_decided'
  ) then
    raise exception 'That action is recorded by the operation that performs it'
      using errcode = '42501';
  end if;

  insert into admin_audit_log
    (actor_id, actor_role, action, subject_type, subject_id,
     outcome, reason, detail, actor_ip_hash)
  values
    (actor, role_now, audit_action, subject_type, subject_id,
     effective_outcome, reason,
     coalesce(detail, '{}'::jsonb), actor_ip_hash)
  returning id into new_id;

  return new_id;
end;
$fn$;

comment on function livd_record_admin_audit(text, text, uuid, text, text, jsonb, text) is
  'Writes one audit entry, stamping the actor and their role from the session. A non-staff caller may record only a refusal or a failure, and nobody may record the success of an act whose own function records it.';

-- ---------------------------------------------------------------------------
-- 6a · What a person may read about their own standing
-- ---------------------------------------------------------------------------

drop function if exists livd_my_sanctions();

create function livd_my_sanctions()
returns table (
  action             user_status,
  reason_key         text,
  reason_label       text,
  reason_description text,
  starts_at          timestamptz,
  ends_at            timestamptz,
  lifted_at          timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  -- The category and its public description, never the written reason: that
  -- is a note for the next moderator, and it may name what a report said.
  select s.action, s.reason_key, d.label, d.description, s.starts_at, s.ends_at, s.lifted_at
  from user_sanctions s
  join sanction_reason_defs d on d.key = s.reason_key
  where s.user_id = auth.uid()
  order by s.created_at desc
  limit 20;
$fn$;

revoke execute on function livd_my_sanctions() from public, anon;
grant execute on function livd_my_sanctions() to authenticated;

comment on function livd_my_sanctions() is
  'The caller''s own sanctions: category, description and dates. Never the moderator''s written reason, and never who applied it.';

-- ---------------------------------------------------------------------------
-- 6b · A banned account can be told why
--
-- The filter moves to the dispatcher (src/server/notify/index.ts), which knows
-- whether a message is about the account's own standing.
-- ---------------------------------------------------------------------------

create or replace function livd_notification_recipient(target_user uuid)
returns table (
  user_id                  uuid,
  email                    text,
  locale                   text,
  status                   user_status,
  email_review_updates     boolean,
  email_property_responses boolean,
  email_trust_safety       boolean
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    p.id,
    u.email::text,
    p.preferred_locale,
    p.status,
    p.email_review_updates,
    p.email_property_responses,
    p.email_trust_safety
  from profiles p
  join auth.users u on u.id = p.id
  where p.id = target_user
    and u.email is not null;
$fn$;

revoke execute on function livd_notification_recipient(uuid) from public, anon, authenticated;
grant execute on function livd_notification_recipient(uuid) to service_role;
