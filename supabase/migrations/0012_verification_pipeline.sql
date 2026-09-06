-- ===========================================================================
-- Livd — 0012 · The verification pipeline
--
-- `verification_records` has existed since 0002 with nothing writing to it.
-- The levels worked, weighed the score correctly and could be set by a
-- moderator; what was missing was the part where a resident can actually offer
-- evidence, and the part where a machine settles what a machine can settle
-- before a person is asked.
--
-- The shape of it:
--
--   resident uploads  ->  automated checks  ->  moderator decides  ->  level set
--
-- Nothing in the middle grants anything. The strongest an automated check can
-- do is refuse a submission that cannot be legitimate — an owner trying to
-- verify themselves as a resident of their own building, a file that is not a
-- document. Everything else is a note travelling with the record.
--
-- The evidence itself is the most sensitive thing this product will ever hold:
-- a tenancy agreement carries a name, an address and a signature, and the
-- person handing it over is doing so precisely so they can stay anonymous.
-- So it goes into a bucket with no policy for any client role, is addressed by
-- an opaque key, and reaches a moderator only through a signed URL minted
-- server-side, per view, with minutes on it. `evidence_ref` is a key, never a
-- URL — a URL in a database row is a URL in a backup.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Where the documents live
--
-- Private. `storage.objects` carries RLS, and no policy is created for this
-- bucket, so anon and authenticated are denied outright — including the person
-- who uploaded the file. Only the service role, from server code that has
-- already passed a guard, can read or write it.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'verification-evidence',
  'verification-evidence',
  false,
  8388608,  -- 8MB; a photograph of a document, and anything larger is not one
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- What a record now holds
-- ---------------------------------------------------------------------------

alter table verification_records
  add column if not exists submitted_by    uuid references profiles(id) on delete cascade,
  -- SHA-256 of the file. The one thing that makes "this exact tenancy
  -- agreement has been used by four different residents" answerable without
  -- ever reading a document.
  add column if not exists evidence_sha256 text,
  add column if not exists evidence_mime   text,
  add column if not exists evidence_bytes  bigint check (evidence_bytes is null or evidence_bytes >= 0),
  -- What the automated checks found, verbatim, so the queue shows a moderator
  -- the same thing the code saw.
  add column if not exists checks          jsonb not null default '[]'::jsonb,
  add column if not exists decided_at      timestamptz;

alter table verification_records
  drop constraint if exists verification_records_outcome_check;

alter table verification_records
  add constraint verification_records_outcome_check
  check (outcome in ('pending', 'approved', 'rejected', 'withdrawn'));

-- Duplicate detection, and the moderation queue's own ordering.
create index if not exists verification_records_evidence_hash_idx
  on verification_records (evidence_sha256) where evidence_sha256 is not null;

create index if not exists verification_records_queue_idx
  on verification_records (outcome, created_at) where outcome = 'pending';

create index if not exists verification_records_submitter_idx
  on verification_records (submitted_by, created_at desc);

-- One open request per review. Someone may resubmit after a rejection; they
-- may not queue five at once.
create unique index if not exists verification_records_one_pending
  on verification_records (subject_type, subject_id) where outcome = 'pending';

comment on column verification_records.evidence_ref is
  'Object key in the private verification-evidence bucket. Never a URL: a URL in a row is a URL in a backup.';

comment on column verification_records.checks is
  'Automated findings from src/lib/safety/verification-checks.ts. Advisory — nothing here decides anything.';

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Unchanged, and worth restating because it looks like an omission: RLS is on
-- and there is no policy, which denies every client role including the subject
-- of the record. That is the intent. A resident cannot read back the evidence
-- they submitted, and neither can anyone else with a browser — the only reader
-- is server code holding the service role, after a moderator guard.
--
-- What a resident *can* see is the outcome, which the application returns from
-- a server action rather than by opening the table.
-- ---------------------------------------------------------------------------
