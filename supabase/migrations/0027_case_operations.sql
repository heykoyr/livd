-- ===========================================================================
-- Livd — 0027 · Case operations
--
-- Every write to a case goes through a function here, and every one of those
-- functions writes its timeline event in the same transaction as the change it
-- makes. That is the whole design: a status that moved without an event, or an
-- assignment nobody can see happening, is not a state these tables can reach.
--
-- The same reasoning as `livd_set_user_role` and `livd_reveal_user_identity`.
-- A history assembled by application code that remembers to append to it is a
-- history with gaps in it, and the gaps are always around the interesting part.
--
-- The actor comes from `auth.uid()` in every one, never from an argument.
-- ===========================================================================

/**
 * Appends to a case timeline.
 *
 * Internal — every caller below is a SECURITY DEFINER function in this file,
 * and nothing outside can reach it. Timeline events are written *with* the
 * change they describe, never separately.
 */
create or replace function livd_case_event(
  target_case_id uuid,
  actor          uuid,
  event_kind     text,
  event_summary  text,
  event_detail   jsonb default '{}'::jsonb
)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into case_events (case_id, actor_id, kind, summary, detail)
  values (target_case_id, actor, event_kind, event_summary, coalesce(event_detail, '{}'::jsonb));
$$;

revoke execute on function livd_case_event(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Opening a case
-- ---------------------------------------------------------------------------

/**
 * Opens a case, optionally from a report.
 *
 * When a report is named, the case inherits its review, that review's property
 * and that review's author as subjects — which is the join a moderator would
 * otherwise do by hand, and get wrong occasionally.
 *
 * Idempotent on the report: a report already attached to a case returns that
 * case rather than opening a second one. Two moderators clicking at once is a
 * normal Tuesday, not an error.
 *
 * Opening a case does **nothing** to the review. It is not hidden, not flagged,
 * not touched. If opening a case had a visible effect, opening cases would
 * become the attack.
 */
create or replace function livd_open_case(
  case_category text,
  case_summary  text,
  from_report_id uuid    default null,
  review_id      uuid    default null,
  case_priority_override case_priority default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor       uuid := auth.uid();
  cat         case_category_defs%rowtype;
  new_case    uuid;
  existing    uuid;
  target_review uuid := review_id;
  target_user   uuid;
  target_prop   uuid;
  chosen_priority case_priority;
  new_reference text;
begin
  if actor is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if not livd_is_moderator() then
    raise exception 'Only a moderator may open a case' using errcode = '42501';
  end if;

  if case_summary is null or char_length(btrim(case_summary)) < 3 then
    raise exception 'A case needs a one-line summary' using errcode = '22023';
  end if;

  select * into cat from case_category_defs where key = case_category and is_active;
  if cat.key is null then
    raise exception 'Select a category for this case' using errcode = '22023';
  end if;

  if from_report_id is not null then
    select rr.case_id, rr.review_id into existing, target_review
    from review_reports rr where rr.id = from_report_id;

    if not found then
      raise exception 'No such report' using errcode = 'P0002';
    end if;

    -- Already has a case: hand back the one that exists.
    if existing is not null then
      return existing;
    end if;
  end if;

  if target_review is not null then
    select r.author_id, r.property_id into target_user, target_prop
    from reviews r where r.id = target_review;
  end if;

  chosen_priority := coalesce(case_priority_override, cat.default_priority);

  insert into ts_cases
    (status, priority, category, subject_review_id, subject_user_id,
     subject_property_id, opened_by, summary)
  values
    ('new', chosen_priority, case_category, target_review, target_user,
     target_prop, actor, btrim(case_summary))
  returning id, reference into new_case, new_reference;

  if from_report_id is not null then
    update review_reports set case_id = new_case where id = from_report_id;
  end if;

  perform livd_case_event(
    new_case, actor, 'created',
    'Case opened as ' || cat.label,
    jsonb_strip_nulls(jsonb_build_object(
      'category', case_category,
      'priority', chosen_priority::text,
      'fromReport', from_report_id,
      'reference', new_reference
    ))
  );

  if from_report_id is not null then
    perform livd_case_event(
      new_case, actor, 'report_linked', 'Report attached to this case',
      jsonb_build_object('reportId', from_report_id)
    );
  end if;

  return new_case;
end;
$$;

-- ---------------------------------------------------------------------------
-- Working a case
-- ---------------------------------------------------------------------------

create or replace function livd_assign_case(target_case_id uuid, assignee uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor    uuid := auth.uid();
  previous uuid;
  assignee_ok boolean;
begin
  if actor is null or not livd_is_moderator() then
    raise exception 'Only a moderator may assign a case' using errcode = '42501';
  end if;

  select assigned_to into previous from ts_cases where id = target_case_id for update;
  if not found then
    raise exception 'No such case' using errcode = 'P0002';
  end if;

  if assignee is not null then
    -- A case can only be assigned to somebody who could actually work it.
    select role in ('moderator', 'trust_admin', 'admin') and status = 'active'
      into assignee_ok
    from profiles where id = assignee;

    if not coalesce(assignee_ok, false) then
      raise exception 'A case can only be assigned to an active moderator'
        using errcode = '22023';
    end if;
  end if;

  if previous is not distinct from assignee then
    return;
  end if;

  update ts_cases
  set assigned_to = assignee,
      -- Picking up a new case starts it. Anything further along keeps its
      -- status: reassigning an escalated case does not un-escalate it.
      status = case when status = 'new' and assignee is not null then 'open' else status end
  where id = target_case_id;

  perform livd_case_event(
    target_case_id, actor,
    case when assignee is null then 'unassigned' else 'assigned' end,
    case when assignee is null then 'Case unassigned' else 'Case assigned' end,
    jsonb_strip_nulls(jsonb_build_object('from', previous, 'to', assignee))
  );
end;
$$;

/**
 * Moves a case along.
 *
 * A concluding status needs an outcome written down. That is the point of the
 * whole object: somebody reading `LV-1048` in a year should find what was
 * decided, not just that it stopped being open.
 */
create or replace function livd_set_case_status(
  target_case_id uuid,
  new_status     case_status,
  case_outcome   text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor    uuid := auth.uid();
  previous case_status;
  concluding boolean;
begin
  if actor is null or not livd_is_moderator() then
    raise exception 'Only a moderator may change a case' using errcode = '42501';
  end if;

  select status into previous from ts_cases where id = target_case_id for update;
  if not found then
    raise exception 'No such case' using errcode = 'P0002';
  end if;

  concluding := new_status in ('resolved', 'dismissed', 'closed');

  if concluding and (case_outcome is null or char_length(btrim(case_outcome)) < 3) then
    raise exception 'Say what was decided before closing a case' using errcode = '22023';
  end if;

  if previous = new_status then
    return;
  end if;

  update ts_cases
  set status = new_status,
      outcome = case when concluding then btrim(case_outcome) else outcome end,
      resolved_at = case
        when new_status in ('resolved', 'dismissed') then now()
        else resolved_at end,
      closed_at = case when new_status = 'closed' then now() else closed_at end
  where id = target_case_id;

  perform livd_case_event(
    target_case_id, actor, 'status_changed',
    'Status changed from ' || previous::text || ' to ' || new_status::text,
    jsonb_strip_nulls(jsonb_build_object(
      'from', previous::text,
      'to', new_status::text,
      'outcome', nullif(btrim(coalesce(case_outcome, '')), '')
    ))
  );
end;
$$;

create or replace function livd_set_case_priority(
  target_case_id uuid,
  new_priority   case_priority,
  why            text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor    uuid := auth.uid();
  previous case_priority;
begin
  if actor is null or not livd_is_moderator() then
    raise exception 'Only a moderator may change a case' using errcode = '42501';
  end if;

  select priority into previous from ts_cases where id = target_case_id for update;
  if not found then
    raise exception 'No such case' using errcode = 'P0002';
  end if;

  -- Critical means somebody may be about to be hurt. It is a judgement, and it
  -- is one Trust & Safety makes rather than one a queue drifts into.
  if new_priority = 'critical' and not livd_is_trust_admin() then
    raise exception 'Raising a case to critical requires Trust and Safety authorisation'
      using errcode = '42501';
  end if;

  if previous = new_priority then
    return;
  end if;

  update ts_cases set priority = new_priority where id = target_case_id;

  perform livd_case_event(
    target_case_id, actor, 'priority_changed',
    'Priority changed from ' || previous::text || ' to ' || new_priority::text,
    jsonb_strip_nulls(jsonb_build_object(
      'from', previous::text, 'to', new_priority::text,
      'why', nullif(btrim(coalesce(why, '')), '')
    ))
  );
end;
$$;

create or replace function livd_add_case_note(target_case_id uuid, note_body text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor  uuid := auth.uid();
  new_id uuid;
begin
  if actor is null or not livd_is_moderator() then
    raise exception 'Only a moderator may add a note' using errcode = '42501';
  end if;

  if note_body is null or char_length(btrim(note_body)) < 1 then
    raise exception 'A note needs something in it' using errcode = '22023';
  end if;

  if not exists (select 1 from ts_cases where id = target_case_id) then
    raise exception 'No such case' using errcode = 'P0002';
  end if;

  insert into case_notes (case_id, author_id, body)
  values (target_case_id, actor, btrim(note_body))
  returning id into new_id;

  perform livd_case_event(target_case_id, actor, 'note_added', 'Note added');

  return new_id;
end;
$$;

/** Attaches an existing report to a case. Idempotent. */
create or replace function livd_link_report_to_case(target_case_id uuid, report_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor    uuid := auth.uid();
  existing uuid;
begin
  if actor is null or not livd_is_moderator() then
    raise exception 'Only a moderator may link a report' using errcode = '42501';
  end if;

  select case_id into existing from review_reports where id = report_id for update;
  if not found then
    raise exception 'No such report' using errcode = 'P0002';
  end if;

  if existing is not distinct from target_case_id then
    return;
  end if;

  update review_reports set case_id = target_case_id where id = report_id;

  perform livd_case_event(
    target_case_id, actor, 'report_linked', 'Report attached to this case',
    jsonb_build_object('reportId', report_id)
  );
end;
$$;

/**
 * Puts a case under preservation hold, or lifts one.
 *
 * Trust & Safety only. While it is on, nothing belonging to the case is
 * eligible for routine deletion. This is the hook a retention policy will use;
 * it exists now so that the architecture does not make preservation impossible
 * later, which is far harder to add than a boolean.
 */
create or replace function livd_set_case_preservation(target_case_id uuid, hold boolean, why text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  previous boolean;
begin
  if actor is null or not livd_is_trust_admin() then
    raise exception 'Preservation holds require Trust and Safety authorisation'
      using errcode = '42501';
  end if;

  if why is null or char_length(btrim(why)) < 3 then
    raise exception 'A reason is required, for the audit trail' using errcode = '22023';
  end if;

  select preservation_hold into previous from ts_cases where id = target_case_id for update;
  if not found then
    raise exception 'No such case' using errcode = 'P0002';
  end if;

  if previous = hold then
    return;
  end if;

  update ts_cases set preservation_hold = hold where id = target_case_id;

  perform livd_case_event(
    target_case_id, actor,
    case when hold then 'preservation_applied' else 'preservation_lifted' end,
    case when hold then 'Preservation hold applied' else 'Preservation hold lifted' end,
    jsonb_build_object('reason', btrim(why))
  );
end;
$$;

revoke execute on function livd_open_case(text, text, uuid, uuid, case_priority) from public, anon;
revoke execute on function livd_assign_case(uuid, uuid)                          from public, anon;
revoke execute on function livd_set_case_status(uuid, case_status, text)          from public, anon;
revoke execute on function livd_set_case_priority(uuid, case_priority, text)      from public, anon;
revoke execute on function livd_add_case_note(uuid, text)                         from public, anon;
revoke execute on function livd_link_report_to_case(uuid, uuid)                   from public, anon;
revoke execute on function livd_set_case_preservation(uuid, boolean, text)        from public, anon;

grant execute on function livd_open_case(text, text, uuid, uuid, case_priority) to authenticated;
grant execute on function livd_assign_case(uuid, uuid)                          to authenticated;
grant execute on function livd_set_case_status(uuid, case_status, text)          to authenticated;
grant execute on function livd_set_case_priority(uuid, case_priority, text)      to authenticated;
grant execute on function livd_add_case_note(uuid, text)                         to authenticated;
grant execute on function livd_link_report_to_case(uuid, uuid)                   to authenticated;
grant execute on function livd_set_case_preservation(uuid, boolean, text)        to authenticated;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

create or replace function livd_list_cases(
  page_size       integer default 25,
  page_offset     integer default 0,
  filter_status   case_status   default null,
  filter_priority case_priority default null,
  filter_category text          default null,
  filter_assignee uuid          default null,
  only_unassigned boolean       default false,
  only_open       boolean       default false,
  search_reference text         default null
)
returns table (
  id          uuid,
  reference   text,
  status      case_status,
  priority    case_priority,
  category    text,
  summary     text,
  assigned_to uuid,
  subject_review_id uuid,
  subject_user_id   uuid,
  subject_property_id uuid,
  property_slug   text,
  building_name   text,
  street_address  text,
  locality        text,
  country_code    char(2),
  report_count    bigint,
  note_count      bigint,
  preservation_hold boolean,
  created_at   timestamptz,
  updated_at   timestamptz,
  total_count  bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not livd_is_moderator() then
    raise exception 'Not authorised to read cases' using errcode = '42501';
  end if;

  return query
  select
    c.id, c.reference, c.status, c.priority, c.category, c.summary, c.assigned_to,
    c.subject_review_id, c.subject_user_id, c.subject_property_id,
    p.slug, p.building_name, p.street_address, p.locality, p.country_code,
    (select count(*) from review_reports rr where rr.case_id = c.id),
    (select count(*) from case_notes n where n.case_id = c.id),
    c.preservation_hold, c.created_at, c.updated_at,
    count(*) over () as total_count
  from ts_cases c
  left join properties p on p.id = c.subject_property_id
  where (filter_status is null or c.status = filter_status)
    and (filter_priority is null or c.priority = filter_priority)
    and (filter_category is null or c.category = filter_category)
    and (filter_assignee is null or c.assigned_to = filter_assignee)
    and (not only_unassigned or c.assigned_to is null)
    and (not only_open or c.status not in ('resolved', 'dismissed', 'closed'))
    and (search_reference is null
         or upper(c.reference) like upper(btrim(search_reference)) || '%')
  -- Priority descending puts critical at the top; the enum's own order is the
  -- order it was declared in, which is low → critical.
  order by c.priority desc, c.created_at desc, c.id desc
  limit greatest(1, least(coalesce(page_size, 25), 100))
  offset greatest(0, coalesce(page_offset, 0));
end;
$$;

create or replace function livd_case_timeline(target_case_id uuid, page_size integer default 200)
returns table (
  id         bigint,
  actor_id   uuid,
  kind       text,
  summary    text,
  detail     jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not livd_is_moderator() then
    raise exception 'Not authorised to read cases' using errcode = '42501';
  end if;

  return query
  select e.id, e.actor_id, e.kind, e.summary, e.detail, e.created_at
  from case_events e
  where e.case_id = target_case_id
  order by e.created_at, e.id
  limit greatest(1, least(coalesce(page_size, 200), 500));
end;
$$;

revoke execute on function livd_list_cases(
  integer, integer, case_status, case_priority, text, uuid, boolean, boolean, text
) from public, anon;
revoke execute on function livd_case_timeline(uuid, integer) from public, anon;

grant execute on function livd_list_cases(
  integer, integer, case_status, case_priority, text, uuid, boolean, boolean, text
) to authenticated;
grant execute on function livd_case_timeline(uuid, integer) to authenticated;
