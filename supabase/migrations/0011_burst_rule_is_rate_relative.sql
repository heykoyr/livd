-- ===========================================================================
-- Livd — 0011 · The burst rule compares rates, not raw counts
--
-- 0010 shipped `recent_n > greatest(3, baseline_n)`, which compares a count
-- over 48 hours against a count over 28 days. Testing it against a property
-- with a settled record showed what that costs: eight reviews in the previous
-- month, six in two days — a tenfold jump in rate — and the rule stayed quiet,
-- because six is not more than eight.
--
-- The comparison is now dimensionally honest. The baseline is scaled to the
-- length of the window before anything is compared to it, so the question
-- being asked is "is this property being reviewed several times faster than it
-- normally is", which is the question that was meant all along.
--
-- Three times the property's own rate, and never fewer than five reviews. The
-- multiplier is a judgement, not a discovery: it is low enough to catch a
-- campaign and high enough that a building whose residents are simply talking
-- to each other is not dragged into the queue every week.
--
-- Severity now reflects how far past its own rate a property has gone rather
-- than raw volume, with one exception. A property with no history at all has
-- nothing to be a multiple of, so it stays at severity 1: five reviews in two
-- days on a newly added building is worth a glance and nothing more.
-- ===========================================================================

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
  -- What fraction of the baseline period one window represents.
  window_share numeric := p_window_hours::numeric / (p_baseline_days * 24);
  expected numeric;
  ratio    numeric;
  raised   integer := 0;
  r        record;
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
    /* --- Reviewed far faster than this property normally is -------------- */

    -- How many reviews this window would hold at the property's own rate.
    expected := r.baseline_n * window_share;

    if r.recent_n >= 3 * expected then
      ratio := case when expected > 0 then r.recent_n / expected else null end;

      if livd_raise_property_flag(
        r.property_id,
        'review_burst',
        (case
           -- No history to be a multiple of. Volume alone, so: a glance.
           when ratio is null then 1
           when ratio >= 10 then 3
           when ratio >= 5  then 2
           else 1
         end)::smallint,
        window_start, now(),
        jsonb_build_object(
          'reviews_in_window',   r.recent_n,
          'window_hours',        p_window_hours,
          'reviews_in_baseline', r.baseline_n,
          'baseline_days',       p_baseline_days,
          'expected_in_window',  round(expected, 2),
          'times_usual_rate',    case when ratio is null then null else round(ratio, 1) end
        ),
        case
          when ratio is null then format(
            '%s reviews in %s hours, on a property with no earlier reviews to compare against.',
            r.recent_n, p_window_hours
          )
          else format(
            '%s reviews in %s hours — about %sx the rate implied by %s in the preceding %s days.',
            r.recent_n, p_window_hours, round(ratio, 1), r.baseline_n, p_baseline_days
          )
        end,
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

revoke execute on function livd_detect_property_flags(integer, integer, integer)
  from public, anon, authenticated;
