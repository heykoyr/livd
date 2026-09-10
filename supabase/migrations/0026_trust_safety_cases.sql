-- ===========================================================================
-- Livd — 0026 · Trust & Safety cases
--
-- A report has been a flat row since 0002: a review, a reporter, a reason, a
-- status. Nothing tied two reports about the same review together, nothing
-- carried a priority, nothing recorded who was working on it, and nothing kept
-- a history of what was decided and why. An investigation lived in a
-- moderator's head between opening the page and closing it.
--
-- A case is the object that survives that. It gathers the reports, names the
-- review, the property and the account, holds notes and a timeline, and ends in
-- a decision somebody can read six months later.
--
-- WHAT DOES NOT CHANGE
--
-- `review_reports` keeps every column and every row it has. A case links to
-- reports; it does not replace them, and a report with no case is still a
-- report. The existing moderation queue, the reports page and the resolve
-- action all continue to work untouched — this is additive, and the deployment
-- has real reports to not break.
--
-- A CASE IS NOT A VERDICT
--
-- Opening one changes nothing about the review it concerns. It does not hide
-- it, does not flag it publicly, does not touch its status. That separation is
-- the same one that makes reporting safe: if opening a case did anything
-- visible, opening cases would become the attack.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

create type case_status as enum (
  'new',                  -- nobody has looked yet
  'open',                 -- picked up
  'investigating',        -- actively being worked
  'awaiting_information', -- blocked on somebody outside the team
  'action_taken',         -- something was done; the case is not yet closed
  'escalated',            -- needs a decision above the assignee
  'resolved',             -- concluded, with an outcome
  'dismissed',            -- concluded, nothing to answer
  'closed'                -- filed
);

/**
 * How urgently this needs a person.
 *
 * `critical` is never set by a machine. A keyword is not a threat, and a system
 * that lets one raise a case to the top of the queue is a system anybody can
 * steer by choosing their words.
 */
create type case_priority as enum ('low', 'medium', 'high', 'critical');

create table case_category_defs (
  key         text primary key,
  label       text not null,
  description text not null,
  /** The priority to start at. A suggestion; a person can always move it. */
  default_priority case_priority not null default 'medium',
  sort_order  int  not null default 0,
  is_active   boolean not null default true
);

insert into case_category_defs (key, label, description, default_priority, sort_order) values
  ('spam',                 'Spam', 'Promotional or automated content.', 'low', 10),
  ('fake_review',          'Fake review', 'A review by somebody who did not live there.', 'medium', 20),
  ('review_manipulation',  'Review manipulation', 'Coordinated or incentivised reviewing.', 'high', 30),
  ('harassment',           'Harassment', 'Targeted abuse of a person.', 'high', 40),
  ('threatening_content',  'Threatening content', 'Content that threatens harm.', 'critical', 50),
  ('hate_speech',          'Hate or abusive content', 'Abuse directed at a group.', 'high', 60),
  ('personal_information', 'Personal information', 'Content identifying a person.', 'high', 70),
  ('fraud',                'Fraud or scam', 'Attempted deception for gain.', 'high', 80),
  ('impersonation',        'Impersonation', 'Claiming to be somebody they are not.', 'high', 90),
  ('false_information',    'False or misleading information', 'Factual claims that appear untrue.', 'medium', 100),
  ('owner_dispute',        'Property owner dispute', 'An owner contests a resident experience.', 'medium', 110),
  ('safety_concern',       'Safety concern', 'A concern about conditions at a property.', 'high', 120),
  ('illegal_activity',     'Illegal activity claim', 'An allegation of unlawful conduct.', 'high', 130),
  ('other',                'Other', 'Anything else. Say what it is.', 'medium', 999);

-- ---------------------------------------------------------------------------
-- Cases
-- ---------------------------------------------------------------------------

create sequence case_reference_seq start with 1000;

create table ts_cases (
  id        uuid primary key default gen_random_uuid(),
  -- Human-readable and stable: what a moderator writes in a note, quotes in an
  -- email, and searches for a year later. `LV-1048`.
  reference text not null unique
    default 'LV-' || nextval('case_reference_seq')::text,

  status   case_status   not null default 'new',
  priority case_priority not null default 'medium',
  category text          not null references case_category_defs(key),

  -- What the case is about. All three are optional and all three are severed
  -- rather than cascaded: a case must outlive the review it concerned, or the
  -- record of why something was removed disappears with the thing removed.
  subject_review_id   uuid references reviews(id)    on delete set null,
  subject_user_id     uuid references profiles(id)   on delete set null,
  subject_property_id uuid references properties(id) on delete set null,

  opened_by   uuid references profiles(id) on delete set null,
  assigned_to uuid references profiles(id) on delete set null,

  summary text not null check (char_length(summary) between 3 and 500),
  /** The decision, written when the case concludes. */
  outcome text check (outcome is null or char_length(outcome) <= 2000),

  /**
   * Preservation hold.
   *
   * The foundation for the retention work: while this is true, nothing
   * belonging to this case is eligible for routine deletion. It is a flag
   * rather than a system because a full legal-hold implementation is not
   * warranted yet — but architecture that made preservation impossible later
   * would be, and this prevents that.
   */
  preservation_hold boolean not null default false,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at   timestamptz
);

create trigger ts_cases_set_updated_at
  before update on ts_cases
  for each row execute function set_updated_at();

create index ts_cases_triage_idx   on ts_cases (status, priority desc, created_at desc);
create index ts_cases_assigned_idx on ts_cases (assigned_to, status) where assigned_to is not null;
create index ts_cases_review_idx   on ts_cases (subject_review_id) where subject_review_id is not null;
create index ts_cases_user_idx     on ts_cases (subject_user_id)   where subject_user_id is not null;
create index ts_cases_property_idx on ts_cases (subject_property_id) where subject_property_id is not null;
create index ts_cases_open_idx     on ts_cases (created_at desc)
  where status not in ('resolved', 'dismissed', 'closed');

comment on table ts_cases is
  'One investigation. Gathers reports, names its subjects, and ends in a decision somebody can read later. Opening one changes nothing about the content it concerns.';

-- A report belongs to at most one case; a case gathers many reports. Additive:
-- every existing report keeps its row and simply has no case yet.
alter table review_reports
  add column if not exists case_id uuid references ts_cases(id) on delete set null;

create index if not exists review_reports_case_idx
  on review_reports (case_id) where case_id is not null;

-- ---------------------------------------------------------------------------
-- The timeline
--
-- Append-only, like every other record of what was decided. `kind` is text
-- rather than an enum for the same reason `admin_audit_log.action` is: a
-- timeline write must never fail because somebody added an event type and
-- forgot a migration. The vocabulary lives in TypeScript.
-- ---------------------------------------------------------------------------

create table case_events (
  id        bigserial primary key,
  case_id   uuid not null references ts_cases(id) on delete cascade,
  actor_id  uuid references profiles(id) on delete set null,
  kind      text not null,
  summary   text not null,
  detail    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index case_events_case_idx on case_events (case_id, created_at, id);

create trigger case_events_append_only
  before update or delete on case_events
  for each row execute function livd_forbid_mutation();

revoke update, delete, truncate on table case_events from anon, authenticated, service_role;

comment on table case_events is
  'The case timeline. Append-only by trigger — a history that can be edited is not a history.';

-- ---------------------------------------------------------------------------
-- Notes
--
-- Internal. Never shown to the reviewer, the reporter, the property owner or
-- the public. Editable by nobody, including their author: a note somebody can
-- rewrite after the fact is worth nothing as a record of what was thought at
-- the time.
-- ---------------------------------------------------------------------------

create table case_notes (
  id        uuid primary key default gen_random_uuid(),
  case_id   uuid not null references ts_cases(id) on delete cascade,
  author_id uuid references profiles(id) on delete set null,
  body      text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index case_notes_case_idx on case_notes (case_id, created_at desc);

create trigger case_notes_append_only
  before update or delete on case_notes
  for each row execute function livd_forbid_mutation();

revoke update, delete, truncate on table case_notes from anon, authenticated, service_role;

comment on table case_notes is
  'Internal case notes. Append-only: a note that can be rewritten afterwards is not a record of what was thought at the time.';

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Cases, their events and their notes are moderator-and-above. A reporter has
-- no visibility into the case their report opened, and a property owner has
-- none at all — an owner who could read the investigation into a review of
-- their building would learn far more about its author than the review shows.
--
-- No insert or update policy anywhere. Every write goes through a SECURITY
-- DEFINER function below, which is what keeps the timeline honest: a status
-- that changed without an event is not a state these tables can reach.
-- ---------------------------------------------------------------------------

alter table ts_cases           enable row level security;
alter table case_events        enable row level security;
alter table case_notes         enable row level security;
alter table case_category_defs enable row level security;

create policy cases_read_moderator      on ts_cases    for select using (livd_is_moderator());
create policy case_events_read_moderator on case_events for select using (livd_is_moderator());
create policy case_notes_read_moderator  on case_notes  for select using (livd_is_moderator());
create policy case_categories_read       on case_category_defs for select using (livd_is_moderator());

revoke insert, update, delete on table ts_cases    from anon, authenticated;
revoke insert                 on table case_events from anon, authenticated;
revoke insert                 on table case_notes  from anon, authenticated;
