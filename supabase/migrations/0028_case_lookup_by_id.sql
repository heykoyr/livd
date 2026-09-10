-- ===========================================================================
-- Livd — 0028 · Look a single case up through the listing function
--
-- `livd_list_cases` from 0027 could filter by status, priority, category,
-- assignee and reference — but not by id, which is what a case detail page
-- actually has in its URL.
--
-- The obvious alternative was a second function, or a direct select against
-- `ts_cases` in the adapter. Both mean two places that decide what a case row
-- looks like, and two places is how a list and a detail page drift into
-- disagreeing about the same case. One query, one mapper, one shape.
--
-- Dropped and recreated rather than replaced: `create or replace` with a
-- different parameter list makes an overload, not a replacement, and leaving
-- the old arity resolvable would be a second definition of exactly the thing
-- this migration exists to keep singular.
-- ===========================================================================

drop function if exists livd_list_cases(
  integer, integer, case_status, case_priority, text, uuid, boolean, boolean, text
);

create or replace function livd_list_cases(
  page_size       integer default 25,
  page_offset     integer default 0,
  filter_status   case_status   default null,
  filter_priority case_priority default null,
  filter_category text          default null,
  filter_assignee uuid          default null,
  only_unassigned boolean       default false,
  only_open       boolean       default false,
  search_reference text         default null,
  filter_case_id  uuid          default null
)
returns table (
  id          uuid,
  reference   text,
  status      case_status,
  priority    case_priority,
  category    text,
  summary     text,
  outcome     text,
  assigned_to uuid,
  opened_by   uuid,
  subject_review_id uuid,
  subject_user_id   uuid,
  subject_property_id uuid,
  property_slug   text,
  building_name   text,
  street_address  text,
  neighbourhood   text,
  locality        text,
  admin_area      text,
  postal_code     text,
  country_code    char(2),
  report_count    bigint,
  note_count      bigint,
  preservation_hold boolean,
  created_at   timestamptz,
  updated_at   timestamptz,
  resolved_at  timestamptz,
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
    c.id, c.reference, c.status, c.priority, c.category, c.summary, c.outcome,
    c.assigned_to, c.opened_by,
    c.subject_review_id, c.subject_user_id, c.subject_property_id,
    p.slug, p.building_name, p.street_address, p.neighbourhood,
    p.locality, p.admin_area, p.postal_code, p.country_code,
    (select count(*) from review_reports rr where rr.case_id = c.id),
    (select count(*) from case_notes n where n.case_id = c.id),
    c.preservation_hold, c.created_at, c.updated_at, c.resolved_at,
    count(*) over () as total_count
  from ts_cases c
  left join properties p on p.id = c.subject_property_id
  where (filter_case_id is null or c.id = filter_case_id)
    and (filter_status is null or c.status = filter_status)
    and (filter_priority is null or c.priority = filter_priority)
    and (filter_category is null or c.category = filter_category)
    and (filter_assignee is null or c.assigned_to = filter_assignee)
    and (not only_unassigned or c.assigned_to is null)
    and (not only_open or c.status not in ('resolved', 'dismissed', 'closed'))
    and (search_reference is null
         or upper(c.reference) like upper(btrim(search_reference)) || '%')
  -- Priority descending puts critical at the top: the enum's own order is the
  -- order it was declared in, which is low → critical.
  order by c.priority desc, c.created_at desc, c.id desc
  limit greatest(1, least(coalesce(page_size, 25), 100))
  offset greatest(0, coalesce(page_offset, 0));
end;
$$;

revoke execute on function livd_list_cases(
  integer, integer, case_status, case_priority, text, uuid, boolean, boolean, text, uuid
) from public, anon;

grant execute on function livd_list_cases(
  integer, integer, case_status, case_priority, text, uuid, boolean, boolean, text, uuid
) to authenticated;

comment on function livd_list_cases(
  integer, integer, case_status, case_priority, text, uuid, boolean, boolean, text, uuid
) is
  'Cases, filtered. The single-case read uses this too, with filter_case_id — one query and one mapper, so a list and a detail page cannot disagree about the same case.';
