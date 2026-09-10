-- ===========================================================================
-- Livd — 0029 · The review investigation view
--
-- Deciding whether a review should stay up needs more than the review. It needs
-- what was reported and by whom, what the author has written elsewhere, whether
-- anybody checked they lived there, what has already been decided about this
-- content, and what the property's review activity looks like around it.
--
-- Until now a moderator assembled that from four pages and their memory.
--
-- THE PRIVACY SHAPE
--
-- Everything here sits at one of three levels, and the page is built so a
-- moderator can always tell which they are looking at:
--
--   PUBLIC      what a reader of the property page sees. An anonymous
--               resident, a verification badge, a tenure, a date.
--   INTERNAL    what these functions return. An account id, counts, statuses,
--               decisions. Enough to investigate; nothing that identifies.
--   RESTRICTED  the address, and the residency document. Neither is here.
--               Both are separate, authorised, audited operations.
--
-- WHAT IS DELIBERATELY ABSENT
--
-- No coordinates, no accuracy, no distance — `property_verifications` has never
-- held them, so there is nothing to withhold. What a location check yields is a
-- verdict, a method and a time, which answers "did somebody stand at this
-- building" without answering "where was this person".
--
-- The reviewer's email is not returned by anything in this file.
-- ===========================================================================

/**
 * One review, with everything an investigation needs about it.
 *
 * A single row rather than a join the caller assembles, so the page cannot
 * accidentally omit the context that changes a decision — the author's other
 * reviews being the obvious one. Four reviews of four properties across three
 * years reads very differently from four in a week.
 */
create or replace function livd_admin_review_investigation(target_review_id uuid)
returns table (
  review_id          uuid,
  body               text,
  overall_rating     smallint,
  would_recommend    boolean,
  residency_status   residency_status,
  moved_in_month     date,
  moved_out_month    date,
  tenure_months      int,
  verification_level verification_level,
  verified_at        timestamptz,
  status             review_status,
  safety_flags       text[],
  helpful_count      int,
  created_at         timestamptz,
  updated_at         timestamptz,

  author_id          uuid,
  author_status      user_status,
  author_created_at  timestamptz,
  author_review_count      bigint,
  author_removed_count     bigint,
  author_reports_against   bigint,
  author_verified_count    bigint,

  property_id        uuid,
  property_slug      text,
  building_name      text,
  street_address     text,
  neighbourhood      text,
  locality           text,
  admin_area         text,
  postal_code        text,
  country_code       char(2),
  property_review_count    bigint,
  property_reported_count  bigint,
  property_verified_count  bigint,
  property_recent_count    bigint,
  property_is_claimed      boolean,

  report_count       bigint,
  open_report_count  bigint,
  case_count         bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not livd_is_moderator() then
    raise exception 'Not authorised to investigate a review' using errcode = '42501';
  end if;

  return query
  select
    r.id, r.body, r.overall_rating, r.would_recommend,
    r.residency_status, r.moved_in_month, r.moved_out_month, r.tenure_months,
    r.verification_level, r.verified_at, r.status, r.safety_flags,
    r.helpful_count, r.created_at, r.updated_at,

    r.author_id,
    ap.status,
    ap.created_at,
    coalesce(ac.review_count, 0),
    coalesce(ac.removed_review_count, 0),
    coalesce(ac.reports_against, 0),
    coalesce(ac.verified_review_count, 0),

    p.id, p.slug,
    p.building_name, p.street_address, p.neighbourhood,
    p.locality, p.admin_area, p.postal_code, p.country_code,
    (select count(*) from reviews pr where pr.property_id = p.id and pr.status = 'published'),
    (select count(distinct rr.review_id) from review_reports rr
       join reviews pr on pr.id = rr.review_id where pr.property_id = p.id),
    (select count(*) from reviews pr where pr.property_id = p.id
       and pr.verification_level in ('location_verified', 'verified_resident')),
    (select count(*) from reviews pr where pr.property_id = p.id
       and pr.created_at > now() - interval '90 days'),
    coalesce(ps.is_claimed, false),

    (select count(*) from review_reports rr where rr.review_id = r.id),
    (select count(*) from review_reports rr where rr.review_id = r.id and rr.status = 'open'),
    (select count(*) from ts_cases c where c.subject_review_id = r.id)

  from reviews r
  join properties p on p.id = r.property_id
  left join property_stats ps on ps.property_id = p.id
  -- The author may be null: a deleted account leaves its reviews standing and
  -- permanently unattributable, which is what every legal page promises.
  left join profiles ap on ap.id = r.author_id
  left join lateral livd_admin_user_counts(r.author_id) ac on r.author_id is not null
  where r.id = target_review_id;
end;
$$;

/**
 * What was checked about this review's author, at this property.
 *
 * A verdict, a method and a time. No coordinate, no accuracy, no distance —
 * `property_verifications` has never held them, so there is nothing here to
 * decide whether to withhold.
 *
 * A moderator investigating verification abuse needs to know that forty checks
 * came from one account across nine buildings. They do not need to know where
 * anybody was standing, and the schema could not tell them if they asked.
 */
create or replace function livd_admin_review_verification(target_review_id uuid)
returns table (
  kind            text,
  id              uuid,
  method          text,
  outcome         text,
  failure_reason  text,
  at_this_property boolean,
  created_at      timestamptz,
  decided_at      timestamptz,
  has_evidence    boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  author  uuid;
  prop    uuid;
begin
  if not livd_is_moderator() then
    raise exception 'Not authorised to investigate a review' using errcode = '42501';
  end if;

  select r.author_id, r.property_id into author, prop
  from reviews r where r.id = target_review_id;

  if author is null then
    return;
  end if;

  return query
  -- Location checks: every one this account has made, flagged for whether it
  -- was at the property under investigation.
  select
    'location'::text,
    pv.id,
    pv.method::text,
    pv.status::text,
    pv.failure_reason::text,
    pv.property_id = prop,
    pv.created_at,
    null::timestamptz,
    false
  from property_verifications pv
  where pv.user_id = author

  union all

  -- Residency submissions: that one exists, what was decided, and whether a
  -- document is attached. The document itself is not reachable from here —
  -- opening it is a separate, audited operation.
  select
    'residency'::text,
    vr.id,
    vr.method,
    vr.outcome,
    null::text,
    vr.subject_id = target_review_id,
    vr.created_at,
    vr.decided_at,
    vr.evidence_ref is not null
  from verification_records vr
  where vr.submitted_by = author

  order by created_at desc
  limit 50;
end;
$$;

/**
 * Reports and cases about one review.
 *
 * The reporter is an id and nothing more. A moderator needs to see that the
 * same account filed nine reports; who that account belongs to is a separate
 * question with a separate authorisation.
 */
create or replace function livd_admin_review_reports(target_review_id uuid)
returns table (
  report_id   uuid,
  reporter_id uuid,
  reason      report_reason,
  detail      text,
  status      report_status,
  resolution  text,
  case_id     uuid,
  case_reference text,
  created_at  timestamptz,
  resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not livd_is_moderator() then
    raise exception 'Not authorised to investigate a review' using errcode = '42501';
  end if;

  return query
  select rr.id, rr.reporter_id, rr.reason, rr.detail, rr.status, rr.resolution,
         rr.case_id, c.reference, rr.created_at, rr.resolved_at
  from review_reports rr
  left join ts_cases c on c.id = rr.case_id
  where rr.review_id = target_review_id
  order by rr.created_at desc;
end;
$$;

revoke execute on function livd_admin_review_investigation(uuid) from public, anon;
revoke execute on function livd_admin_review_verification(uuid)  from public, anon;
revoke execute on function livd_admin_review_reports(uuid)       from public, anon;

grant execute on function livd_admin_review_investigation(uuid) to authenticated;
grant execute on function livd_admin_review_verification(uuid)  to authenticated;
grant execute on function livd_admin_review_reports(uuid)       to authenticated;

comment on function livd_admin_review_investigation(uuid) is
  'Everything an investigation needs about one review, in one row. Returns an account id, never an address.';
comment on function livd_admin_review_verification(uuid) is
  'What was checked about this author: a verdict, a method and a time. Never a position — the schema has never held one.';
