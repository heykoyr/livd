-- ===========================================================================
-- Livd — 0033 · Authority requests and disclosure records
--
-- Somewhere to record that a body with an apparent legal basis has asked Livd
-- for information about an account, what was decided, and — separately — what
-- was actually handed over.
--
-- WHAT THIS DELIBERATELY IS NOT
--
-- There is no function here that gathers a user's data, and none that sends
-- anything anywhere. Nothing in this migration can read an email address, a
-- review, a verification record or a location check on somebody's behalf.
--
-- That absence is the design. A button that assembles and transmits an
-- account's data on request is a button that will eventually be pressed for a
-- request nobody read properly, and the whole point of a process like this is
-- that a person reads the request properly. What the system does is remember:
-- who asked, on what basis, what was decided, by whom, and what left the
-- building. The judgement stays with people, and the record of it does not.
--
-- A DISCLOSURE IS A SEPARATE ROW FROM A DECISION
--
-- Approving a request and disclosing something are two events, and modelling
-- them as one would make "we approved it but never sent anything" unrecordable
-- — which is a real and common outcome. A request can be approved and never
-- fulfilled; it can be partially approved and one field disclosed of three
-- asked for. `disclosure_records` says what actually left.
--
-- DATA MINIMISATION IS A COLUMN, NOT A POLICY DOCUMENT
--
-- `disclosed_fields` is an explicit list. There is no "everything" value, and
-- no default. Somebody recording a disclosure has to name what went, which is
-- the point at which "we sent them the account" becomes "we sent them the
-- registration date and nothing else".
--
-- NOTHING HERE IS LEGAL ADVICE OR LEGAL COMPLIANCE. It is the software
-- infrastructure a process needs. Livd operates globally and the rules around
-- disclosure, notification and retention differ by jurisdiction; those
-- questions need professional review, and this schema is built so that whatever
-- the answers turn out to be, the record exists to support them.
-- ===========================================================================

create type authority_request_status as enum (
  'received',
  'under_review',
  'needs_clarification',
  'awaiting_legal_review',
  'approved',
  'partially_approved',
  'declined',
  'fulfilled',
  'closed'
);

create table authority_requests (
  id        uuid primary key default gen_random_uuid(),
  reference text not null unique
    default 'AR-' || nextval('case_reference_seq')::text,

  /** Who asked. A name, as given — never inferred or looked up. */
  requesting_authority text not null check (char_length(requesting_authority) between 2 and 200),
  /** Where they say they have authority. Free text: the world is not a dropdown. */
  jurisdiction text not null check (char_length(jurisdiction) between 2 and 120),

  request_type text not null check (request_type in (
    'account_information',
    'content_preservation',
    'content_removal',
    'emergency_disclosure',
    'other'
  )),

  /** Their own case or reference number, so a follow-up can be matched to it. */
  external_reference text,

  /** What they asked for, in their words rather than a summary of them. */
  requested_information text not null
    check (char_length(requested_information) between 3 and 4000),

  /** The basis they assert. Recorded as a claim, never as a finding. */
  legal_basis text,
  /** Whether Livd has the paperwork, as opposed to an assertion in an email. */
  documentation_received boolean not null default false,

  status authority_request_status not null default 'received',

  received_at timestamptz not null default now(),

  assigned_to uuid references profiles(id) on delete set null,
  opened_by   uuid references profiles(id) on delete set null,

  /** What Livd decided, and why. Required before a request may be concluded. */
  decision      text,
  decided_by    uuid references profiles(id) on delete set null,
  decided_at    timestamptz,

  /** The case this concerns, where there is one. */
  case_id uuid references ts_cases(id) on delete set null,
  /** The account this concerns, where the request names one. */
  subject_user_id uuid references profiles(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger authority_requests_set_updated_at
  before update on authority_requests
  for each row execute function set_updated_at();

create index authority_requests_status_idx on authority_requests (status, received_at desc);
create index authority_requests_subject_idx on authority_requests (subject_user_id)
  where subject_user_id is not null;
create index authority_requests_open_idx on authority_requests (received_at desc)
  where status not in ('fulfilled', 'declined', 'closed');

comment on table authority_requests is
  'Requests from bodies asserting a legal basis. Records and manages them; discloses nothing. No function in this schema gathers or transmits user data.';
comment on column authority_requests.legal_basis is
  'The basis the requester asserts. A claim recorded, never a finding made.';

-- ---------------------------------------------------------------------------
-- What actually left
-- ---------------------------------------------------------------------------

create table disclosure_records (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references authority_requests(id) on delete restrict,

  /** The account whose information was disclosed. */
  subject_user_id uuid references profiles(id) on delete set null,

  /**
   * Exactly what was handed over.
   *
   * An explicit list with no "everything" value and no default. Somebody
   * recording a disclosure has to name the fields, which is the moment "we sent
   * them the account" becomes "we sent them the registration date".
   */
  disclosed_fields text[] not null check (array_length(disclosed_fields, 1) >= 1),

  /** Who received it, and how it went. Both as recorded by the person who sent it. */
  disclosed_to text not null check (char_length(disclosed_to) between 2 and 200),
  method       text not null check (method in ('secure_email', 'portal', 'post', 'in_person', 'other')),

  /** Who inside Livd authorised this. Never the same act as making the decision. */
  authorised_by uuid references profiles(id) on delete set null,
  recorded_by   uuid references profiles(id) on delete set null,

  disclosed_at timestamptz not null default now(),
  notes        text check (notes is null or char_length(notes) <= 2000),

  created_at timestamptz not null default now()
);

create index disclosure_records_request_idx on disclosure_records (request_id, disclosed_at desc);
create index disclosure_records_subject_idx on disclosure_records (subject_user_id)
  where subject_user_id is not null;

create trigger disclosure_records_append_only
  before update or delete on disclosure_records
  for each row execute function livd_forbid_mutation();

revoke update, delete, truncate on table disclosure_records
  from anon, authenticated, service_role;

comment on table disclosure_records is
  'What actually left the building. Append-only. Separate from the decision, because approved-and-never-sent is a real outcome that must stay recordable.';

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- The most restricted tier in the product. Trust & Safety and above only —
-- a moderator has no business in a law-enforcement request, and the accounts
-- these concern have the strongest interest in the smallest possible number of
-- people being able to read them.
-- ---------------------------------------------------------------------------

alter table authority_requests enable row level security;
alter table disclosure_records enable row level security;

create policy authority_requests_read_trust on authority_requests
  for select using (livd_is_trust_admin());

create policy disclosure_records_read_trust on disclosure_records
  for select using (livd_is_trust_admin());

revoke insert, update, delete on table authority_requests from anon, authenticated;
revoke insert                 on table disclosure_records from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------

create or replace function livd_open_authority_request(
  requesting_authority text,
  jurisdiction         text,
  request_type         text,
  requested_information text,
  external_reference   text default null,
  legal_basis          text default null,
  documentation_received boolean default false,
  subject_user_id      uuid default null,
  related_case_id      uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor  uuid := auth.uid();
  new_id uuid;
  new_ref text;
begin
  if actor is null or not livd_is_trust_admin() then
    raise exception 'Recording an authority request requires Trust and Safety authorisation'
      using errcode = '42501';
  end if;

  if char_length(btrim(coalesce(requesting_authority, ''))) < 2 then
    raise exception 'Name the requesting authority' using errcode = '22023';
  end if;

  if char_length(btrim(coalesce(jurisdiction, ''))) < 2 then
    raise exception 'Name the jurisdiction' using errcode = '22023';
  end if;

  if char_length(btrim(coalesce(requested_information, ''))) < 3 then
    raise exception 'Record what was asked for' using errcode = '22023';
  end if;

  insert into authority_requests (
    requesting_authority, jurisdiction, request_type, requested_information,
    external_reference, legal_basis, documentation_received,
    subject_user_id, case_id, opened_by
  )
  values (
    btrim(requesting_authority), btrim(jurisdiction), request_type,
    btrim(requested_information),
    nullif(btrim(coalesce(external_reference, '')), ''),
    nullif(btrim(coalesce(legal_basis, '')), ''),
    coalesce(documentation_received, false),
    subject_user_id, related_case_id, actor
  )
  returning id, reference into new_id, new_ref;

  insert into admin_audit_log
    (actor_id, actor_role, action, subject_type, subject_id, outcome, reason, detail)
  select actor, p.role, 'authority_request_created', 'authority_request', new_id,
         'succeeded', btrim(requesting_authority) || ' — ' || btrim(jurisdiction),
         jsonb_strip_nulls(jsonb_build_object(
           'reference', new_ref,
           'requestType', request_type,
           'subjectUserId', subject_user_id,
           'caseId', related_case_id
         ))
  from profiles p where p.id = actor;

  if related_case_id is not null then
    perform livd_case_event(
      related_case_id, actor, 'authority_request_linked',
      'Authority request ' || new_ref || ' recorded',
      jsonb_build_object('requestId', new_id)
    );
  end if;

  return new_id;
end;
$$;

/**
 * Moves a request along.
 *
 * A concluding status needs a written decision. "Declined" with no reasoning is
 * exactly the record that will be asked about later.
 */
create or replace function livd_decide_authority_request(
  request_id     uuid,
  new_status     authority_request_status,
  decision_text  text default null,
  -- Named `docs_received` rather than matching the column: an unqualified
  -- reference inside the UPDATE below would otherwise be ambiguous between the
  -- parameter and the column, which Postgres refuses at call time rather than
  -- at creation. A parameter that shadows a column is a runtime error waiting
  -- for the first person to use that argument.
  docs_received  boolean default null,
  assign_to      uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor    uuid := auth.uid();
  previous authority_request_status;
  concluding boolean;
begin
  if actor is null or not livd_is_trust_admin() then
    raise exception 'Deciding an authority request requires Trust and Safety authorisation'
      using errcode = '42501';
  end if;

  select status into previous from authority_requests where id = request_id for update;
  if previous is null then
    raise exception 'No such request' using errcode = 'P0002';
  end if;

  concluding := new_status in
    ('approved', 'partially_approved', 'declined', 'fulfilled', 'closed');

  if concluding and char_length(btrim(coalesce(decision_text, ''))) < 3 then
    raise exception 'Write the decision before concluding a request' using errcode = '22023';
  end if;

  update authority_requests
  set status = new_status,
      decision = case when concluding then btrim(decision_text) else decision end,
      decided_by = case when concluding then actor else decided_by end,
      decided_at = case when concluding then now() else decided_at end,
      documentation_received = coalesce(docs_received, documentation_received),
      assigned_to = coalesce(assign_to, assigned_to)
  where id = request_id;

  insert into admin_audit_log
    (actor_id, actor_role, action, subject_type, subject_id, outcome, reason, detail)
  select actor, p.role, 'authority_request_updated', 'authority_request', request_id,
         'succeeded', nullif(btrim(coalesce(decision_text, '')), ''),
         jsonb_build_object('from', previous::text, 'to', new_status::text)
  from profiles p where p.id = actor;
end;
$$;

/**
 * Records that information was disclosed.
 *
 * This does not disclose anything. It writes down that a person, having read a
 * request and made a decision, sent something — and exactly what. The system
 * never assembles or transmits the data, and there is no code path here that
 * could.
 *
 * Refuses unless the request has been approved, in whole or in part. A
 * disclosure against a declined or undecided request is either a mistake or
 * something far worse, and either way the database should not quietly accept
 * it.
 */
create or replace function livd_record_disclosure(
  request_id       uuid,
  disclosed_fields text[],
  disclosed_to     text,
  method           text,
  notes            text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor     uuid := auth.uid();
  req       authority_requests%rowtype;
  new_id    uuid;
begin
  if actor is null or not livd_is_trust_admin() then
    raise exception 'Recording a disclosure requires Trust and Safety authorisation'
      using errcode = '42501';
  end if;

  select * into req from authority_requests where id = request_id for update;
  if req.id is null then
    raise exception 'No such request' using errcode = 'P0002';
  end if;

  if req.status not in ('approved', 'partially_approved', 'fulfilled') then
    raise exception 'That request has not been approved' using errcode = '22023';
  end if;

  if disclosed_fields is null or array_length(disclosed_fields, 1) is null then
    raise exception 'Name exactly what was disclosed' using errcode = '22023';
  end if;

  if char_length(btrim(coalesce(disclosed_to, ''))) < 2 then
    raise exception 'Record who received it' using errcode = '22023';
  end if;

  insert into disclosure_records
    (request_id, subject_user_id, disclosed_fields, disclosed_to, method,
     authorised_by, recorded_by, notes)
  values
    (request_id, req.subject_user_id, disclosed_fields, btrim(disclosed_to), method,
     req.decided_by, actor, nullif(btrim(coalesce(notes, '')), ''))
  returning id into new_id;

  update authority_requests set status = 'fulfilled' where id = request_id;

  insert into admin_audit_log
    (actor_id, actor_role, action, subject_type, subject_id, outcome, reason, detail)
  select actor, p.role, 'disclosure_recorded', 'authority_request', request_id,
         'succeeded',
         'Disclosed to ' || btrim(disclosed_to),
         jsonb_strip_nulls(jsonb_build_object(
           'disclosureId', new_id,
           'reference', req.reference,
           -- The field *names*, never their values. An audit log holding the
           -- disclosed data would be a second copy of the disclosure.
           'fields', to_jsonb(disclosed_fields),
           'subjectUserId', req.subject_user_id,
           'method', method
         ))
  from profiles p where p.id = actor;

  if req.case_id is not null then
    perform livd_case_event(
      req.case_id, actor, 'disclosure_recorded',
      'Information disclosed under ' || req.reference,
      jsonb_build_object('disclosureId', new_id)
    );
  end if;

  return new_id;
end;
$$;

create or replace function livd_list_authority_requests(
  filter_status authority_request_status default null,
  only_open     boolean default false,
  page_size     integer default 50
)
returns table (
  id         uuid,
  reference  text,
  requesting_authority text,
  jurisdiction text,
  request_type text,
  external_reference text,
  requested_information text,
  legal_basis text,
  documentation_received boolean,
  status     authority_request_status,
  received_at timestamptz,
  assigned_to uuid,
  decision   text,
  decided_by uuid,
  decided_at timestamptz,
  case_id    uuid,
  case_reference text,
  subject_user_id uuid,
  disclosure_count bigint,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not livd_is_trust_admin() then
    raise exception 'Not authorised to read authority requests' using errcode = '42501';
  end if;

  return query
  select r.id, r.reference, r.requesting_authority, r.jurisdiction, r.request_type,
         r.external_reference, r.requested_information, r.legal_basis,
         r.documentation_received, r.status, r.received_at, r.assigned_to,
         r.decision, r.decided_by, r.decided_at,
         r.case_id, c.reference, r.subject_user_id,
         (select count(*) from disclosure_records d where d.request_id = r.id),
         r.created_at
  from authority_requests r
  left join ts_cases c on c.id = r.case_id
  where (filter_status is null or r.status = filter_status)
    and (not only_open or r.status not in ('fulfilled', 'declined', 'closed'))
  order by r.received_at desc, r.id desc
  limit greatest(1, least(coalesce(page_size, 50), 200));
end;
$$;

create or replace function livd_list_disclosures(target_request_id uuid default null)
returns table (
  id         uuid,
  request_id uuid,
  subject_user_id uuid,
  disclosed_fields text[],
  disclosed_to text,
  method     text,
  authorised_by uuid,
  recorded_by uuid,
  disclosed_at timestamptz,
  notes      text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not livd_is_trust_admin() then
    raise exception 'Not authorised to read disclosures' using errcode = '42501';
  end if;

  return query
  select d.id, d.request_id, d.subject_user_id, d.disclosed_fields, d.disclosed_to,
         d.method, d.authorised_by, d.recorded_by, d.disclosed_at, d.notes
  from disclosure_records d
  where (target_request_id is null or d.request_id = target_request_id)
  order by d.disclosed_at desc, d.id desc
  limit 200;
end;
$$;

revoke execute on function livd_open_authority_request(text, text, text, text, text, text, boolean, uuid, uuid)
  from public, anon;
revoke execute on function livd_decide_authority_request(uuid, authority_request_status, text, boolean, uuid)
  from public, anon;
revoke execute on function livd_record_disclosure(uuid, text[], text, text, text) from public, anon;
revoke execute on function livd_list_authority_requests(authority_request_status, boolean, integer)
  from public, anon;
revoke execute on function livd_list_disclosures(uuid) from public, anon;

grant execute on function livd_open_authority_request(text, text, text, text, text, text, boolean, uuid, uuid)
  to authenticated;
grant execute on function livd_decide_authority_request(uuid, authority_request_status, text, boolean, uuid)
  to authenticated;
grant execute on function livd_record_disclosure(uuid, text[], text, text, text) to authenticated;
grant execute on function livd_list_authority_requests(authority_request_status, boolean, integer)
  to authenticated;
grant execute on function livd_list_disclosures(uuid) to authenticated;

comment on function livd_record_disclosure(uuid, text[], text, text, text) is
  'Records that a person disclosed something. Discloses nothing itself — no function in this schema gathers or transmits user data.';
