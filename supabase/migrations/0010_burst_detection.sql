-- ===========================================================================
-- Livd — 0010 · Burst detection
--
-- `docs/architecture.md` §7 has listed this as "scheduled aggregate over recent
-- reviews per property; flags, never auto-deletes" since Phase 5, with nothing
-- behind it. This is the job.
--
-- Three decisions worth stating before the SQL.
--
-- 1. It flags, and only flags. Nothing here changes a review's status, hides
--    it, or moves a score. A property that has just been written about by
--    twenty delighted residents looks identical, from the outside, to one
--    being astroturfed — the difference is a judgement, and a judgement needs
--    a person. This job's job is to make sure a person is asked.
--
-- 2. Every threshold is relative to the property's own history, never to a
--    global constant. "Five reviews in two days" means nothing without knowing
--    whether the building normally gets five a year or fifty a week.
--
-- 3. A flag carries the arithmetic that produced it. A moderator opening the
--    queue should be able to see the numbers and disagree with them, rather
--    than being handed a verdict.
--
-- It runs on pg_cron rather than a route on a timer: no shared secret to leak,
-- nothing to authenticate, and it keeps running when the application does not.
-- ===========================================================================

create type property_flag_kind as enum (
  'review_burst',
  'rating_anomaly',
  'new_account_concentration'
);

create type property_flag_status as enum ('open', 'reviewed', 'dismissed');

create table property_flags (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references properties(id) on delete cascade,
  kind         property_flag_kind not null,
  -- 1 unusual · 2 hard to explain innocently · 3 look at this today
  severity     smallint not null check (severity between 1 and 3),
  window_start timestamptz not null,
  window_end   timestamptz not null,
  -- The arithmetic behind the flag, so a moderator can disagree with it.
  observed     jsonb not null default '{}'::jsonb,
  detail       text not null,
  status       property_flag_status not null default 'open',
  reviewed_by  uuid references profiles(id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One open flag of each kind per property. A re-run refreshes the numbers on
-- the existing one rather than filling the queue with the same finding hourly.
create unique index property_flags_one_open
  on property_flags (property_id, kind) where status = 'open';

create index property_flags_triage_idx
  on property_flags (status, severity desc, created_at desc);

create trigger property_flags_set_updated_at
  before update on property_flags
  for each row execute function set_updated_at();

comment on table property_flags is
  'Automated trust-and-safety signals awaiting a human decision. Never acted on automatically.';

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Moderators read and decide. Nobody else sees these at all: telling a review
-- author that their property has been flagged tells whoever is running a
-- campaign exactly when to stop.
-- ---------------------------------------------------------------------------

alter table property_flags enable row level security;

create policy property_flags_read_moderator on property_flags
  for select to authenticated
  using (livd_is_moderator());

create policy property_flags_decide_moderator on property_flags
  for update to authenticated
  using (livd_is_moderator())
  with check (livd_is_moderator());

-- No insert policy: rows come from the detector, which runs as its owner.
-- No delete policy: a flag that was raised stays on the record.

-- ---------------------------------------------------------------------------
-- Raising one flag
-- ---------------------------------------------------------------------------

create or replace function livd_raise_property_flag(
  p_property_id   uuid,
  p_kind          property_flag_kind,
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
  -- A moderator who has already decided on this exact finding should not be
  -- shown it again an hour later. A genuinely new burst raises a new flag once
  -- the cooldown has passed.
  if exists (
    select 1 from property_flags
    where property_id = p_property_id
      and kind = p_kind
      and status <> 'open'
      and reviewed_at > now() - make_interval(days => p_cooldown_days)
  ) then
    return false;
  end if;

  insert into property_flags (
    property_id, kind, severity, window_start, window_end, observed, detail
  )
  values (
    p_property_id, p_kind, p_severity, p_window_start, p_window_end, p_observed, p_detail
  )
  on conflict (property_id, kind) where status = 'open'
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

-- ---------------------------------------------------------------------------
-- The detector
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
    -- Below five, any pattern is noise: nothing worth a moderator's attention
    -- could not also be four people and a coincidence.
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

  return raised;
end;
$fn$;

-- Neither is an endpoint. See 0008 for why revoking from PUBLIC alone is not
-- enough on Supabase.
revoke execute on function livd_detect_property_flags(integer, integer, integer)
  from public, anon, authenticated;

revoke execute on function livd_raise_property_flag(
  uuid, property_flag_kind, smallint, timestamptz, timestamptz, jsonb, text, integer
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Schedule
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;

select cron.schedule(
  'livd-detect-property-flags',
  '17 * * * *',
  'select livd_detect_property_flags();'
);

-- Sweeps rate-limit rows left behind by actors that stopped calling mid-window.
-- The function is from 0009; the schedule belongs with the other one.
select cron.schedule(
  'livd-prune-rate-limit-events',
  '41 3 * * *',
  'select livd_prune_rate_limit_events();'
);
