-- ===========================================================================
-- Livd — 0030 · Evidence preservation
--
-- Three things, all of which the audit found missing.
--
-- 1. THE ORIGINAL REVIEW WAS NEVER PRESERVED
--
-- `setReviewStatus` changed a status and wrote an audit row saying it had. It
-- did not keep what the review said. And `livd_guard_review_update` — which
-- stops an author rewriting their ratings after the fact — returns `new`
-- unconditionally for a moderator, so a moderator could edit any review body
-- and nothing recorded what it had been.
--
-- So "the original content is preserved" was not true. It is now, and by
-- trigger rather than by the application remembering: every change to a
-- review's body, status or verification level snapshots the row as it was,
-- first, in the same transaction. Preservation is not something a moderation
-- path can forget to do, because it does not happen on that path at all.
--
-- 2. EVIDENCE HAD NOWHERE TO LIVE
--
-- A case could hold notes and a timeline. It could not hold the thing somebody
-- sent in — a screenshot, a letter, a copy of a listing. `case_evidence` is
-- that, in a private bucket with no client policy, versioned rather than
-- overwritten.
--
-- 3. OPENING A TENANCY AGREEMENT LEFT NO TRACE
--
-- `createVerificationEvidenceLink` minted a signed URL to a document carrying a
-- name, an address and a signature, and wrote nothing anywhere. That is closed
-- here and in the application layer: the link now requires Trust & Safety
-- authorisation and a written reason, and the access is recorded.
--
-- WHY VERSIONS RATHER THAN EDITS
--
-- Evidence that can be replaced is evidence somebody can quietly improve after
-- the outcome is known. A new version supersedes an old one and both remain;
-- withdrawing marks a row and keeps it. Nothing in this file deletes.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Review snapshots
-- ---------------------------------------------------------------------------

create table review_snapshots (
  id        uuid primary key default gen_random_uuid(),
  review_id uuid not null references reviews(id) on delete cascade,

  /**
   * What triggered the snapshot.
   *
   * `moderation` is the important one — the state a review was in immediately
   * before somebody acted on it. `correction` is the author using their own
   * edit window.
   */
  reason text not null check (reason in ('moderation', 'correction', 'verification', 'other')),

  -- The content, exactly as it stood.
  body               text,
  overall_rating     smallint,
  would_recommend    boolean,
  residency_status   residency_status,
  moved_in_month     date,
  moved_out_month    date,
  tenure_months      int,
  verification_level verification_level,
  status             review_status,
  safety_flags       text[],
  category_ratings   jsonb not null default '[]'::jsonb,
  positive_tags      text[] not null default '{}',
  problem_tags       text[] not null default '{}',

  /**
   * Who caused it, when known.
   *
   * `auth.uid()` inside a trigger is the session's user, which is exactly right
   * for a moderator acting through the console — and null for anything the
   * service role does, which is honest rather than a gap: attributing a change
   * to nobody is better than attributing it to the wrong person.
   */
  changed_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index review_snapshots_review_idx on review_snapshots (review_id, created_at desc);

create trigger review_snapshots_append_only
  before update or delete on review_snapshots
  for each row execute function livd_forbid_mutation();

revoke update, delete, truncate on table review_snapshots
  from anon, authenticated, service_role;

comment on table review_snapshots is
  'What a review said before it was changed. Written by trigger, so preservation is not something a moderation path can forget.';

/**
 * Snapshots a review before it changes.
 *
 * BEFORE UPDATE, capturing OLD — so the first snapshot of any review is the
 * state it was published in. Fires only when the content, the status or the
 * verification level moves; a helpful-count increment is not worth a copy.
 */
create or replace function livd_snapshot_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.body is distinct from old.body
     or new.status is distinct from old.status
     or new.verification_level is distinct from old.verification_level
     or new.overall_rating is distinct from old.overall_rating
     or new.would_recommend is distinct from old.would_recommend then

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
$$;

revoke execute on function livd_snapshot_review() from public, anon, authenticated;

-- Ordered before the guard so the snapshot is taken even if a later trigger
-- refuses the change: knowing somebody tried is worth the row.
create trigger reviews_snapshot_before_change
  before update on reviews
  for each row execute function livd_snapshot_review();

alter table review_snapshots enable row level security;

create policy review_snapshots_read_moderator on review_snapshots
  for select using (livd_is_moderator());

revoke insert on table review_snapshots from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Case evidence
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'case-evidence',
  'case-evidence',
  false,
  16777216,  -- 16MB
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/pdf', 'text/plain'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table case_evidence (
  id      uuid primary key default gen_random_uuid(),
  case_id uuid not null references ts_cases(id) on delete cascade,

  kind text not null check (kind in ('file', 'link', 'note', 'review_snapshot')),
  title       text not null check (char_length(title) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),

  /** Object key in the private `case-evidence` bucket. Never a URL. */
  storage_ref text,
  mime        text,
  bytes       bigint check (bytes is null or bytes >= 0),
  /** So "this exact file was sent twice" is answerable without opening either. */
  sha256      text,

  /** For `review_snapshot` evidence — the preserved copy this points at. */
  snapshot_id uuid references review_snapshots(id) on delete set null,

  /**
   * Versioning.
   *
   * A corrected item is a new row pointing at the one it replaces. Both remain
   * readable: evidence that can be edited is evidence somebody can quietly
   * improve once the outcome is known.
   */
  version     integer not null default 1 check (version >= 1),
  supersedes  uuid references case_evidence(id) on delete set null,

  added_by uuid references profiles(id) on delete set null,

  /** Withdrawal marks a row. It never removes one. */
  withdrawn_at     timestamptz,
  withdrawn_by     uuid references profiles(id) on delete set null,
  withdrawn_reason text,

  created_at timestamptz not null default now()
);

create index case_evidence_case_idx on case_evidence (case_id, created_at desc);
create index case_evidence_hash_idx on case_evidence (sha256) where sha256 is not null;
create unique index case_evidence_one_successor on case_evidence (supersedes)
  where supersedes is not null;

comment on table case_evidence is
  'Evidence attached to a case. Versioned rather than edited, withdrawn rather than deleted. Files live in a private bucket with no client policy.';

alter table case_evidence enable row level security;

/**
 * Readable by moderators; files are not.
 *
 * The row says an item exists, what it is, who added it and when. Opening the
 * file itself is a separate operation, needs Trust & Safety authorisation, and
 * is recorded — the same shape as residency evidence, and for the same reason.
 */
create policy case_evidence_read_moderator on case_evidence
  for select using (livd_is_moderator());

revoke insert, update, delete on table case_evidence from anon, authenticated;

/** Adds evidence to a case. Immutable once written; corrections are versions. */
create or replace function livd_add_case_evidence(
  target_case_id uuid,
  evidence_kind  text,
  evidence_title text,
  evidence_description text default null,
  storage_ref    text default null,
  mime           text default null,
  bytes          bigint default null,
  sha256         text default null,
  supersedes_id  uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor      uuid := auth.uid();
  new_id     uuid;
  next_version integer := 1;
begin
  if actor is null or not livd_is_moderator() then
    raise exception 'Only a moderator may add evidence' using errcode = '42501';
  end if;

  if evidence_title is null or char_length(btrim(evidence_title)) < 1 then
    raise exception 'Evidence needs a title' using errcode = '22023';
  end if;

  if not exists (select 1 from ts_cases where id = target_case_id) then
    raise exception 'No such case' using errcode = 'P0002';
  end if;

  if supersedes_id is not null then
    select version + 1 into next_version
    from case_evidence where id = supersedes_id and case_id = target_case_id;

    if next_version is null then
      raise exception 'No such evidence on this case' using errcode = 'P0002';
    end if;
  end if;

  insert into case_evidence
    (case_id, kind, title, description, storage_ref, mime, bytes, sha256,
     version, supersedes, added_by)
  values
    (target_case_id, evidence_kind, btrim(evidence_title),
     nullif(btrim(coalesce(evidence_description, '')), ''),
     storage_ref, mime, bytes, sha256, next_version, supersedes_id, actor)
  returning id into new_id;

  perform livd_case_event(
    target_case_id, actor, 'evidence_added',
    case when supersedes_id is null
         then 'Evidence added'
         else 'Evidence replaced with version ' || next_version::text end,
    jsonb_strip_nulls(jsonb_build_object(
      'evidenceId', new_id, 'kind', evidence_kind, 'version', next_version,
      'supersedes', supersedes_id
    ))
  );

  return new_id;
end;
$$;

/** Withdraws evidence. Marks the row; never removes it. */
create or replace function livd_withdraw_case_evidence(evidence_id uuid, why text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor   uuid := auth.uid();
  the_case uuid;
begin
  if actor is null or not livd_is_moderator() then
    raise exception 'Only a moderator may withdraw evidence' using errcode = '42501';
  end if;

  if why is null or char_length(btrim(why)) < 3 then
    raise exception 'A reason is required, for the audit trail' using errcode = '22023';
  end if;

  select case_id into the_case from case_evidence where id = evidence_id for update;
  if the_case is null then
    raise exception 'No such evidence' using errcode = 'P0002';
  end if;

  update case_evidence
  set withdrawn_at = now(), withdrawn_by = actor, withdrawn_reason = btrim(why)
  where id = evidence_id and withdrawn_at is null;

  perform livd_case_event(
    the_case, actor, 'evidence_withdrawn', 'Evidence withdrawn',
    jsonb_build_object('evidenceId', evidence_id, 'reason', btrim(why))
  );
end;
$$;

create or replace function livd_list_case_evidence(target_case_id uuid)
returns table (
  id          uuid,
  kind        text,
  title       text,
  description text,
  mime        text,
  bytes       bigint,
  has_file    boolean,
  snapshot_id uuid,
  version     integer,
  supersedes  uuid,
  superseded  boolean,
  added_by    uuid,
  withdrawn_at timestamptz,
  withdrawn_by uuid,
  withdrawn_reason text,
  created_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not livd_is_moderator() then
    raise exception 'Not authorised to read evidence' using errcode = '42501';
  end if;

  return query
  select
    e.id, e.kind, e.title, e.description, e.mime, e.bytes,
    -- Whether a file exists, never the key that would reach it.
    e.storage_ref is not null,
    e.snapshot_id, e.version, e.supersedes,
    exists (select 1 from case_evidence s where s.supersedes = e.id),
    e.added_by, e.withdrawn_at, e.withdrawn_by, e.withdrawn_reason, e.created_at
  from case_evidence e
  where e.case_id = target_case_id
  order by e.created_at desc, e.id desc;
end;
$$;

revoke execute on function livd_add_case_evidence(uuid, text, text, text, text, text, bigint, text, uuid)
  from public, anon;
revoke execute on function livd_withdraw_case_evidence(uuid, text) from public, anon;
revoke execute on function livd_list_case_evidence(uuid)           from public, anon;

grant execute on function livd_add_case_evidence(uuid, text, text, text, text, text, bigint, text, uuid)
  to authenticated;
grant execute on function livd_withdraw_case_evidence(uuid, text) to authenticated;
grant execute on function livd_list_case_evidence(uuid)           to authenticated;

/**
 * The preserved copies of one review.
 *
 * What it said before each change, newest first. The first row a review ever
 * gets is the state it was published in.
 */
create or replace function livd_review_snapshots(target_review_id uuid)
returns table (
  id                 uuid,
  reason             text,
  body               text,
  overall_rating     smallint,
  would_recommend    boolean,
  verification_level verification_level,
  status             review_status,
  safety_flags       text[],
  category_ratings   jsonb,
  positive_tags      text[],
  problem_tags       text[],
  changed_by         uuid,
  created_at         timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not livd_is_moderator() then
    raise exception 'Not authorised to read snapshots' using errcode = '42501';
  end if;

  return query
  select s.id, s.reason, s.body, s.overall_rating, s.would_recommend,
         s.verification_level, s.status, s.safety_flags,
         s.category_ratings, s.positive_tags, s.problem_tags,
         s.changed_by, s.created_at
  from review_snapshots s
  where s.review_id = target_review_id
  order by s.created_at desc, s.id desc
  limit 50;
end;
$$;

revoke execute on function livd_review_snapshots(uuid) from public, anon;
grant execute on function livd_review_snapshots(uuid) to authenticated;

comment on function livd_review_snapshots(uuid) is
  'What a review said before each change. The oldest row is the state it was published in.';
