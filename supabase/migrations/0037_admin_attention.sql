-- ===========================================================================
-- Livd — 0037 · What needs attention
--
-- The dashboard used to ask "how much is there", and answer it with nine
-- separate HEAD counts and five cards that were usually zeros. Five zeros is
-- not an absence of work, it is noise with an absence of work hidden in it,
-- and a console that looks the same on a quiet Tuesday as on the morning
-- somebody has been mass-reporting a building is a console nobody scans.
--
-- This asks a different question, and the difference is almost entirely in one
-- extra column per queue: the age of the oldest thing waiting.
--
-- A count says three reports are open. It cannot say one of them has been open
-- nine days, which is the only part a person seeing the number needs to act
-- on. Everything in Trust & Safety degrades with time — a review nobody has
-- looked at is still visible, a resident waiting on verification is waiting
-- with their review counting for less, an authority request has a clock on it
-- somebody else is keeping. Age is the signal; the count is context.
--
-- WHY ONE FUNCTION
--
-- It replaces nine round trips with one, which matters for a page every
-- moderator opens first. But the real reason is that the dashboard's shape
-- should be decided in one place. Nine independent counts assembled in
-- TypeScript is nine chances for one of them to mean something slightly
-- different from the others, and a "needs attention" surface built out of
-- numbers that disagree is worse than no surface at all.
--
-- WHAT IT DOES NOT RETURN
--
-- No identity, no email, no review body, no position. The dashboard says how
-- much and how old, and every route out of it goes through a page that
-- authorises and records whatever it shows.
-- ===========================================================================

create or replace function livd_admin_attention()
returns table (
  -- Queues: how many, and how long the oldest has waited.
  pending_reviews         bigint,
  oldest_pending_review   timestamptz,
  open_reports            bigint,
  oldest_open_report      timestamptz,
  open_flags              bigint,
  oldest_open_flag        timestamptz,
  pending_verifications   bigint,
  oldest_pending_verification timestamptz,
  pending_claims          bigint,
  oldest_pending_claim    timestamptz,

  -- Cases, which is what the work is organised around.
  open_cases              bigint,
  unassigned_cases        bigint,
  my_cases                bigint,
  critical_cases          bigint,
  oldest_open_case        timestamptz,

  -- Trust & Safety only. Null for a moderator rather than zero: zero would say
  -- "there are none", and the truthful answer is "not yours to see".
  open_authority_requests bigint,
  preservation_holds      bigint,
  sanctions_expiring      bigint,
  refusals_7d             bigint,

  -- Platform context. Deliberately last: it is the least urgent thing here.
  property_count          bigint,
  review_count            bigint,
  user_count              bigint,
  reviews_30d             bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  viewer    uuid := auth.uid();
  privileged boolean := livd_is_trust_admin();
begin
  if not livd_is_moderator() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  return query
  select
    (select count(*) from reviews where status = 'pending_moderation'),
    (select min(created_at) from reviews where status = 'pending_moderation'),

    (select count(*) from review_reports where status = 'open'),
    (select min(created_at) from review_reports where status = 'open'),

    (select count(*) from property_flags where status = 'open'),
    (select min(created_at) from property_flags where status = 'open'),

    (select count(*) from verification_records where outcome = 'pending'),
    (select min(created_at) from verification_records where outcome = 'pending'),

    (select count(*) from property_claims where status = 'pending'),
    (select min(created_at) from property_claims where status = 'pending'),

    -- "Open" means not concluded. A case in `action_taken` still needs
    -- somebody to close it, and one `escalated` needs somebody senior — both
    -- are work, and both would vanish from a naive `status = 'open'` count.
    (select count(*) from ts_cases
      where status not in ('resolved', 'dismissed', 'closed')),
    (select count(*) from ts_cases
      where status not in ('resolved', 'dismissed', 'closed') and assigned_to is null),
    (select count(*) from ts_cases
      where status not in ('resolved', 'dismissed', 'closed') and assigned_to = viewer),
    (select count(*) from ts_cases
      where status not in ('resolved', 'dismissed', 'closed') and priority = 'critical'),
    (select min(created_at) from ts_cases
      where status not in ('resolved', 'dismissed', 'closed')),

    case when privileged then (select count(*) from authority_requests
      where status not in ('fulfilled', 'declined', 'closed')) end,
    case when privileged then (select count(*) from ts_cases
      where preservation_hold) end,
    -- Ending within the week. A sanction that lapses unnoticed is a decision
    -- reversing itself, which is the sort of thing a person should choose.
    case when privileged then (select count(*) from user_sanctions
      where lifted_at is null
        and ends_at is not null
        and ends_at between now() and now() + interval '7 days') end,
    -- Refused attempts in the last week. Not an accusation: one is ordinary,
    -- and a run of them from one account is the thing an access log exists to
    -- surface.
    case when privileged then (select count(*) from admin_audit_log
      where outcome = 'denied' and created_at >= now() - interval '7 days') end,

    (select count(*) from properties where status = 'active'),
    (select count(*) from reviews where status = 'published'),
    (select count(*) from profiles),
    (select count(*) from reviews where created_at >= now() - interval '30 days');
end;
$fn$;

revoke execute on function livd_admin_attention() from public, anon;
grant  execute on function livd_admin_attention() to authenticated;

comment on function livd_admin_attention() is
  'The dashboard in one query: how much is waiting and how long it has waited. Counts and ages only, never identity or content.';
