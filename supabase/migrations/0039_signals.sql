-- ===========================================================================
-- Livd — 0039 · Signals
--
-- Three changes, all of them to the same idea: a signal is a question put to a
-- person, and it should reach one.
--
-- 1. REPORTING CAMPAIGNS ARE NOW VISIBLE
--
--    The detector from 0010 only sees abuse that concentrates on one building,
--    and everything it looks at is a review arriving. But the lever an unhappy
--    owner actually has is not writing reviews — it is reporting them, and
--    twelve reports against one property in a day is exactly the shape of a
--    campaign to get honest reviews taken down.
--
--    Nothing in Livd noticed that, which meant the one abuse most likely to be
--    aimed at reviewers was the one abuse with no signal attached. Upholding a
--    report already does not remove anything, so a campaign could not
--    mechanically succeed — but it could exhaust a moderator into agreeing,
--    and nobody would have seen the shape of it.
--
-- 2. SIGNALS ABOUT ACCOUNTS, NOT ONLY ABOUT PROPERTIES
--
--    An account writing one glowing review of each of twenty buildings in an
--    afternoon raises nothing at all today: one review per property is not a
--    burst anywhere. The pattern is only visible when you stop looking
--    property by property, and there was nowhere in the schema to put it.
--
--    `account_signals` is that place. It deliberately mirrors
--    `property_flags` — same severity scale, same open/reviewed/dismissed,
--    same rule that the arithmetic travels with the finding — so a moderator
--    learns one idea rather than two.
--
-- 3. A SIGNAL CAN OPEN A CASE
--
--    This is the part that matters most, and it is the smallest.
--
--    Until now a flag ended at a moderator marking it reviewed or dismissed.
--    That is a verdict on the *signal*, and it left no room for the answer
--    "this needs looking into" — the thing an unexplained pattern most often
--    warrants. `livd_open_case_from_signal` turns a signal into a case, with
--    the arithmetic copied into the first timeline event, and records on the
--    signal which case came out of it.
--
--    NOTHING ANYWHERE IN THIS FILE TOUCHES A REVIEW. No status changes, no
--    visibility changes, no score changes, no account standing. A detector
--    that could act would eventually act on a property that had simply become
--    popular, and there is no threshold clever enough to be trusted with that.
--    The strongest thing a signal can do is cause a person to be asked.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Where a signal led
--
-- Additive, nullable, on both signal tables. A flag with a case is a flag
-- somebody decided to investigate; a flag without one has either not been
-- looked at or was explicable on sight, and those are different states that a
-- single reviewed/dismissed pair could not express.
-- ---------------------------------------------------------------------------

alter table property_flags
  add column if not exists case_id uuid references ts_cases(id) on delete set null;

comment on column property_flags.case_id is
  'The case opened from this signal, if a moderator decided it needed investigating.';

-- ---------------------------------------------------------------------------
-- Signals about an account
--
-- Same shape as `property_flags`, deliberately.
-- ---------------------------------------------------------------------------

create type account_signal_kind as enum (
  -- One account, many different properties, in a short window.
  'author_spread',
  -- One account filing reports far faster than anybody else, and having them
  -- dismissed. Not "reports a lot" — reports a lot and is usually wrong.
  'serial_reporter'
);

create table account_signals (
  id      uuid primary key default gen_random_uuid(),

  -- Cascades with the account. A signal about somebody who has deleted their
  -- account is about nobody: there is no longer a person to ask about it, and
  -- keeping the row would be keeping a suspicion with no subject.
  user_id uuid not null references profiles(id) on delete cascade,

  kind     account_signal_kind not null,
  -- 1 unusual · 2 hard to explain innocently · 3 look at this today
  severity smallint not null check (severity between 1 and 3),

  window_start timestamptz not null,
  window_end   timestamptz not null,

  -- The arithmetic behind the signal, so a moderator can disagree with the
  -- rule rather than only with its conclusion.
  observed jsonb not null default '{}'::jsonb,
  detail   text  not null,

  status      property_flag_status not null default 'open',
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,

  case_id uuid references ts_cases(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table account_signals is
  'Patterns in one account''s behaviour that are invisible property by property. Questions for a person, never findings.';

create unique index account_signals_one_open
  on account_signals (user_id, kind) where status = 'open';

create index account_signals_triage_idx
  on account_signals (status, severity desc, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Readable by moderators and above; nothing else, and never by the subject.
-- Telling somebody which pattern in their behaviour was noticed is telling
-- them precisely what to avoid next time.
-- ---------------------------------------------------------------------------

alter table account_signals enable row level security;

create policy account_signals_read_staff on account_signals
  for select using (livd_is_moderator());

revoke insert, update, delete on table account_signals from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Raising one
-- ---------------------------------------------------------------------------

create or replace function livd_raise_account_signal(
  p_user_id       uuid,
  p_kind          account_signal_kind,
  p_severity      smallint,
  p_window_start  timestamptz,
  p_window_end    timestamptz,
  p_observed      jsonb,
  p_detail        text,
  p_cooldown_days integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- A moderator who has decided on this exact finding should not meet it again
  -- an hour later. The same cooldown as `livd_raise_property_flag`.
  if exists (
    select 1 from account_signals
    where user_id = p_user_id
      and kind = p_kind
      and status <> 'open'
      and reviewed_at > now() - make_interval(days => p_cooldown_days)
  ) then
    return false;
  end if;

  insert into account_signals (
    user_id, kind, severity, window_start, window_end, observed, detail
  )
  values (
    p_user_id, p_kind, p_severity, p_window_start, p_window_end, p_observed, p_detail
  )
  on conflict (user_id, kind) where status = 'open'
  do update set
    severity     = excluded.severity,
    window_start = excluded.window_start,
    window_end   = excluded.window_end,
    observed     = excluded.observed,
    detail       = excluded.detail,
    updated_at   = now();

  return true;
end;
$fn$;

revoke execute on function livd_raise_account_signal(
  uuid, account_signal_kind, smallint, timestamptz, timestamptz, jsonb, text, integer
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Detecting them
-- ---------------------------------------------------------------------------

create or replace function livd_detect_account_signals(
  p_window_hours  integer default 48,
  p_cooldown_days integer default 7
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  window_start timestamptz := now() - make_interval(hours => p_window_hours);
  raised integer := 0;
  r      record;
begin
  /* --- One account, many buildings ------------------------------------- */

  for r in
    select rv.author_id,
           count(distinct rv.property_id) as properties,
           count(*)                       as reviews
    from reviews rv
    where rv.status = 'published'
      and rv.author_id is not null
      and rv.created_at >= window_start
    group by rv.author_id
    -- Four buildings in two days is the floor. Three is a person who moved,
    -- helped a friend and reviewed their old flat, and there is no version of
    -- that worth a moderator's afternoon.
    having count(distinct rv.property_id) >= 4
  loop
    if livd_raise_account_signal(
      r.author_id,
      'author_spread',
      (case when r.properties >= 10 then 3 when r.properties >= 6 then 2 else 1 end)::smallint,
      window_start, now(),
      jsonb_build_object(
        'properties_reviewed', r.properties,
        'reviews_written',     r.reviews,
        'window_hours',        p_window_hours
      ),
      format(
        '%s reviews across %s different %s in %s hours.',
        r.reviews, r.properties,
        case when r.properties = 1 then 'property' else 'properties' end,
        p_window_hours
      ),
      p_cooldown_days
    ) then
      raised := raised + 1;
    end if;
  end loop;

  /* --- One account, many reports, mostly wrong -------------------------- */

  for r in
    select rr.reporter_id,
           count(*)                                          as reports,
           count(*) filter (where rr.status = 'dismissed')    as dismissed,
           count(distinct rv.property_id)                     as properties
    from review_reports rr
    join reviews rv on rv.id = rr.review_id
    where rr.created_at >= window_start
    group by rr.reporter_id
    having count(*) >= 6
       -- Reporting a lot is not the signal. Reporting a lot and being wrong is.
       -- An unresolved report counts as neither, so somebody whose reports are
       -- simply waiting is never flagged for the queue's own backlog.
       and count(*) filter (where rr.status = 'dismissed') >= 4
  loop
    if livd_raise_account_signal(
      r.reporter_id,
      'serial_reporter',
      (case when r.dismissed >= 10 then 3 else 2 end)::smallint,
      window_start, now(),
      jsonb_build_object(
        'reports_filed',      r.reports,
        'reports_dismissed',  r.dismissed,
        'properties_targeted', r.properties,
        'window_hours',       p_window_hours
      ),
      format(
        '%s reports in %s hours, %s of them dismissed, across %s %s.',
        r.reports, p_window_hours, r.dismissed, r.properties,
        case when r.properties = 1 then 'property' else 'properties' end
      ),
      p_cooldown_days
    ) then
      raised := raised + 1;
    end if;
  end loop;

  return raised;
end;
$fn$;

revoke execute on function livd_detect_account_signals(integer, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reporting campaigns against one property
--
-- Added to the existing property detector rather than beside it, so there is
-- one job, one schedule and one place to read what Livd watches for.
-- ---------------------------------------------------------------------------

create or replace function livd_detect_property_flags(
  p_window_hours  integer default 48,
  p_baseline_days integer default 28,
  p_cooldown_days integer default 7
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  window_start   timestamptz := now() - make_interval(hours => p_window_hours);
  baseline_start timestamptz := now() - make_interval(hours => p_window_hours)
                                      - make_interval(days  => p_baseline_days);
  raised integer := 0;
  r      record;
begin
  for r in
    with recent as (
      select
        property_id,
        count(*)                          as n,
        avg(overall_rating)::numeric(4,2) as mean_rating,
        count(*) filter (
          where author_created_at > created_at - interval '7 days'
        )                                 as fresh_authors
      from (
        select rv.property_id, rv.overall_rating, rv.created_at,
               p.created_at as author_created_at
        from reviews rv
        join profiles p on p.id = rv.author_id
        where rv.status = 'published' and rv.created_at >= window_start
      ) w
      group by property_id
    ),
    baseline as (
      select
        property_id,
        count(*)                          as n,
        avg(overall_rating)::numeric(4,2) as mean_rating
      from reviews
      where status = 'published'
        and created_at >= baseline_start
        and created_at <  window_start
      group by property_id
    )
    select
      recent.property_id,
      recent.n             as recent_n,
      recent.mean_rating   as recent_mean,
      recent.fresh_authors,
      coalesce(baseline.n, 0) as baseline_n,
      baseline.mean_rating    as baseline_mean
    from recent
    left join baseline using (property_id)
    where recent.n >= 5
  loop
    /* --- More reviews than the property's own history explains ----------- */
    if r.recent_n > greatest(3, r.baseline_n) then
      if livd_raise_property_flag(
        r.property_id,
        'review_burst',
        (case when r.recent_n >= 20 then 3 when r.recent_n >= 10 then 2 else 1 end)::smallint,
        window_start, now(),
        jsonb_build_object(
          'reviews_in_window',   r.recent_n,
          'window_hours',        p_window_hours,
          'reviews_in_baseline', r.baseline_n,
          'baseline_days',       p_baseline_days
        ),
        format(
          '%s reviews in %s hours, against %s in the preceding %s days.',
          r.recent_n, p_window_hours, r.baseline_n, p_baseline_days
        ),
        p_cooldown_days
      ) then
        raised := raised + 1;
      end if;
    end if;

    /* --- Recent ratings that disagree sharply with the record ------------ */
    if r.baseline_n >= 5 and abs(r.recent_mean - r.baseline_mean) >= 1.5 then
      if livd_raise_property_flag(
        r.property_id,
        'rating_anomaly',
        (case when abs(r.recent_mean - r.baseline_mean) >= 2.5 then 3 else 2 end)::smallint,
        window_start, now(),
        jsonb_build_object(
          'recent_mean',   r.recent_mean,
          'baseline_mean', r.baseline_mean,
          'recent_n',      r.recent_n,
          'baseline_n',    r.baseline_n
        ),
        format(
          'Recent reviews average %s out of 5, against %s across the previous %s.',
          r.recent_mean, r.baseline_mean, r.baseline_n
        ),
        p_cooldown_days
      ) then
        raised := raised + 1;
      end if;
    end if;

    /* --- Written mostly by accounts that had just been created ----------- */
    if r.fresh_authors::numeric / r.recent_n >= 0.6 then
      if livd_raise_property_flag(
        r.property_id,
        'new_account_concentration',
        (case when r.fresh_authors::numeric / r.recent_n >= 0.85 then 3 else 2 end)::smallint,
        window_start, now(),
        jsonb_build_object(
          'reviews_in_window',          r.recent_n,
          'from_accounts_under_a_week', r.fresh_authors
        ),
        format(
          '%s of %s recent reviews came from accounts created in the week before writing.',
          r.fresh_authors, r.recent_n
        ),
        p_cooldown_days
      ) then
        raised := raised + 1;
      end if;
    end if;
  end loop;

  /* --- Reports arriving against one property faster than they should ----- */

  for r in
    select rv.property_id,
           count(*)                          as reports,
           count(distinct rr.reporter_id)     as reporters,
           count(distinct rr.review_id)       as reviews_targeted
    from review_reports rr
    join reviews rv on rv.id = rr.review_id
    where rr.created_at >= window_start
    group by rv.property_id
    having count(*) >= 6
  loop
    -- Many reporters is a building people are genuinely angry about. *Few*
    -- reporters filing many reports is a campaign, and the severity says so.
    if livd_raise_property_flag(
      r.property_id,
      'report_campaign',
      (case
        when r.reporters <= 2 and r.reports >= 10 then 3
        when r.reporters <= 3                     then 3
        when r.reports   >= 12                    then 2
        else 1
      end)::smallint,
      window_start, now(),
      jsonb_build_object(
        'reports_in_window', r.reports,
        'distinct_reporters', r.reporters,
        'reviews_targeted',   r.reviews_targeted,
        'window_hours',       p_window_hours
      ),
      format(
        '%s reports in %s hours from %s %s, against %s reviews.',
        r.reports, p_window_hours, r.reporters,
        case when r.reporters = 1 then 'account' else 'accounts' end,
        r.reviews_targeted
      ),
      p_cooldown_days
    ) then
      raised := raised + 1;
    end if;
  end loop;

  return raised;
end;
$fn$;

revoke execute on function livd_detect_property_flags(integer, integer, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- From a signal to an investigation
--
-- The point of the phase. A signal used to end at reviewed or dismissed, which
-- is a verdict on the *signal* and leaves no room for the answer an unexplained
-- pattern most often warrants: this needs looking into.
--
-- The arithmetic travels into the case's first timeline event, so somebody
-- reading the case in three weeks sees what was actually observed rather than
-- somebody's paraphrase of it.
--
-- The signal is marked `reviewed` rather than left open — it has been acted
-- on, and the case is now where the work lives.
-- ---------------------------------------------------------------------------

create or replace function livd_open_case_from_signal(
  signal_kind text,
  signal_id   uuid,
  why         text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  actor    uuid := auth.uid();
  new_case uuid;
  flag     property_flags%rowtype;
  sig      account_signals%rowtype;
  summary  text;
  observed jsonb;
begin
  if actor is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if not livd_is_moderator() then
    raise exception 'Only a moderator may open a case' using errcode = '42501';
  end if;

  if signal_kind not in ('property', 'account') then
    raise exception 'A signal is about a property or an account' using errcode = '22023';
  end if;

  if why is null or char_length(btrim(why)) < 3 then
    raise exception 'Say what you want looked into' using errcode = '22023';
  end if;

  if signal_kind = 'property' then
    select * into flag from property_flags where id = signal_id for update;
    if flag.id is null then
      raise exception 'No such signal' using errcode = 'P0002';
    end if;

    -- Already investigated: hand back the case rather than opening a second.
    if flag.case_id is not null then
      return flag.case_id;
    end if;

    summary  := btrim(why);
    observed := flag.observed;
  else
    select * into sig from account_signals where id = signal_id for update;
    if sig.id is null then
      raise exception 'No such signal' using errcode = 'P0002';
    end if;

    if sig.case_id is not null then
      return sig.case_id;
    end if;

    summary  := btrim(why);
    observed := sig.observed;
  end if;

  -- `review_manipulation` rather than a category per signal kind. The case is
  -- about what somebody suspects, not about which rule noticed it, and the
  -- rule is in the timeline where it belongs.
  new_case := livd_open_case(
    'review_manipulation', summary, null::uuid, null::uuid, null::case_priority
  );

  if signal_kind = 'property' then
    update property_flags
       set case_id     = new_case,
           status      = 'reviewed',
           reviewed_by = actor,
           reviewed_at = now(),
           updated_at  = now()
     where id = signal_id;

    update ts_cases set subject_property_id = flag.property_id where id = new_case;
  else
    update account_signals
       set case_id     = new_case,
           status      = 'reviewed',
           reviewed_by = actor,
           reviewed_at = now(),
           updated_at  = now()
     where id = signal_id;

    update ts_cases set subject_user_id = sig.user_id where id = new_case;
  end if;

  perform livd_case_event(
    new_case, actor, 'signal_linked',
    'Opened from an automated signal',
    jsonb_build_object('signalKind', signal_kind, 'signalId', signal_id) || coalesce(observed, '{}'::jsonb)
  );

  return new_case;
end;
$fn$;

revoke execute on function livd_open_case_from_signal(text, uuid, text) from public, anon;
grant  execute on function livd_open_case_from_signal(text, uuid, text) to authenticated;

comment on function livd_open_case_from_signal(text, uuid, text) is
  'Turns a signal into a case, copying the arithmetic into the timeline. Changes no review, no score and no account.';

-- ---------------------------------------------------------------------------
-- Reading account signals
-- ---------------------------------------------------------------------------

create or replace function livd_list_account_signals(
  filter_status text default 'open'
)
returns table (
  id           uuid,
  user_id      uuid,
  kind         text,
  severity     smallint,
  window_start timestamptz,
  window_end   timestamptz,
  observed     jsonb,
  detail       text,
  status       text,
  case_id      uuid,
  case_reference text,
  created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not livd_is_moderator() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  return query
  select s.id, s.user_id, s.kind::text, s.severity, s.window_start, s.window_end,
         s.observed, s.detail, s.status::text, s.case_id, c.reference, s.created_at
  from account_signals s
  left join ts_cases c on c.id = s.case_id
  where filter_status is null or s.status::text = filter_status
  order by s.severity desc, s.created_at desc
  limit 200;
end;
$fn$;

revoke execute on function livd_list_account_signals(text) from public, anon;
grant  execute on function livd_list_account_signals(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Deciding one, without touching anything else
-- ---------------------------------------------------------------------------

create or replace function livd_decide_account_signal(
  signal_id  uuid,
  new_status text
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if not livd_is_moderator() then
    raise exception 'Only a moderator may decide a signal' using errcode = '42501';
  end if;

  if new_status not in ('reviewed', 'dismissed') then
    raise exception 'A signal is reviewed or dismissed' using errcode = '22023';
  end if;

  -- Note what this does not do. Deciding a signal changes the signal. It does
  -- not restrict the account, hide their reviews or alter their standing —
  -- those are separate decisions, each with its own authorisation and its own
  -- written reason, and none of them is a side effect of triaging a queue.
  update account_signals
     set status      = new_status::property_flag_status,
         reviewed_by = actor,
         reviewed_at = now(),
         updated_at  = now()
   where id = signal_id;

  if not found then
    raise exception 'No such signal' using errcode = 'P0002';
  end if;
end;
$fn$;

revoke execute on function livd_decide_account_signal(uuid, text) from public, anon;
grant  execute on function livd_decide_account_signal(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Schedule
--
-- Twenty-three past, six minutes after the property detector, so the two never
-- contend for the same rows.
-- ---------------------------------------------------------------------------

select cron.schedule(
  'livd-detect-account-signals',
  '23 * * * *',
  'select livd_detect_account_signals();'
);
