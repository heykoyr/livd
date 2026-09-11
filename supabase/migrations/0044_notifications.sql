-- ===========================================================================
-- Livd — 0044 · Telling people what happened
--
-- Livd has never sent a message of its own. A review is published and the
-- person who wrote it finds out by going and looking; a claim is approved and
-- the claimant is told nothing; a report opens and a moderator learns of it
-- the next time they open the console. `notifications` has existed since 0002
-- as a table nothing writes to.
--
-- This migration is the part of that which belongs in the database: who may
-- be written to, how a send is prevented from happening twice, and where the
-- address comes from.
--
-- THE ADDRESS PROBLEM
--
-- Livd's whole design keeps email addresses out of application memory.
-- `profiles` has no email column; `AdminUserSummary` has no email field;
-- reading a real address is `livd_reveal_user_identity`, which is
-- Trust & Safety only and writes an audit entry in the same transaction.
--
-- Sending somebody an email needs their address, and that is a genuinely
-- different act from a human looking one up. It is automatic, it is addressed
-- *to* the person rather than *about* them, nobody learns anything, and the
-- address never reaches a page — it goes from Postgres to the mail provider
-- inside one server call.
--
-- So it gets its own door: `livd_notification_recipient`, SECURITY DEFINER,
-- EXECUTE revoked from `anon` and `authenticated` and granted to nothing else,
-- which in Supabase leaves `service_role` (and the owner) as the only callers.
-- It deliberately does NOT write an identity-access audit entry. Recording a
-- transactional send in the log that exists to answer "which moderator looked
-- up whose identity" would fill that log with events no human performed, and
-- an access log nobody can read is a log nobody reads.
--
-- WHAT PREVENTS FIVE COPIES OF THE SAME EMAIL
--
-- `notification_events.dedupe_key`, unique. A sender claims an event with
--
--     insert ... on conflict (dedupe_key) do nothing returning id
--
-- and sends only if a row came back. Two concurrent callers, a retry, a
-- moderator clicking twice, a status written five times by five updates — all
-- of them resolve to one row and therefore one send, because the uniqueness is
-- decided by the database rather than by a check-then-act in application code.
--
-- The table is also the delivery log: attempts, last error, sent_at. That is
-- what makes "did they get it" answerable without the provider's dashboard.
--
-- WHAT IS NOT IN THE PAYLOAD
--
-- No email address, ever — the payload holds ids and short display strings the
-- template needs. No review body. Nothing about who wrote a review is put in a
-- payload addressed to a property owner; the send path has no way to reach it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Preferences
--
-- Three switches, not thirty. They correspond to the three reasons Livd would
-- ever write to somebody, and a fourth reason should have to argue for itself.
--
-- Defaults are on, and that is the right default for transactional mail about
-- your own content: somebody who publishes a review and is never told it went
-- live has been given a worse product, not a quieter one.
--
-- Operational mail to staff is not covered here. It follows the role, and a
-- moderator who does not want it should not be a moderator that week.
-- ---------------------------------------------------------------------------

alter table profiles
  add column if not exists email_review_updates     boolean not null default true,
  add column if not exists email_property_responses boolean not null default true,
  add column if not exists email_trust_safety       boolean not null default true;

comment on column profiles.email_review_updates is
  'Your review was published, held, removed or restored.';
comment on column profiles.email_property_responses is
  'A property responded to your review, or a review was published on a property you have claimed.';
comment on column profiles.email_trust_safety is
  'Decisions about your account and its standing.';

-- THE GRANT THAT IS EASY TO FORGET
--
-- 0020 revoked UPDATE on `profiles` from `authenticated` wholesale and granted
-- it back on exactly two columns — `country_code` and `preferred_locale` — so
-- that a role write is refused by privilege before any policy is consulted.
--
-- A column added afterwards is therefore unwritable by its own owner until it
-- is named here. Adding three preference columns and stopping would have
-- shipped a settings page whose every save failed, and the failure would have
-- read as an RLS problem rather than a missing grant. That is the same shape
-- as 0021 and 0042: a privilege removed at the table level quietly disables
-- everything added later.
--
-- `profiles_update_own` (`using id = auth.uid()`) is still the only UPDATE
-- policy, so this grant means "my own three switches" and nothing wider. The
-- 0020 trigger still refuses any change to `role` or `status` from any role
-- including this one.

grant update (
  country_code,
  preferred_locale,
  email_review_updates,
  email_property_responses,
  email_trust_safety
) on table profiles to authenticated;

-- ---------------------------------------------------------------------------
-- The delivery ledger
-- ---------------------------------------------------------------------------

create table if not exists notification_events (
  id             uuid primary key default gen_random_uuid(),

  -- The idempotency key. Shaped `<kind>:<subject id>` — `review_published:
  -- <review uuid>` — so the same real-world event computes the same key from
  -- any code path that notices it.
  dedupe_key     text not null unique check (char_length(dedupe_key) between 3 and 200),

  kind           text not null check (char_length(kind) between 2 and 64),

  -- Null for a send to a role rather than to a person, and null again once
  -- that person deletes their account. The ledger entry survives the account,
  -- like every other record here, carrying no way back to them.
  recipient_id   uuid references profiles(id) on delete set null,

  -- `user`, or the role a fan-out went to. Never an address.
  recipient_kind text not null default 'user'
                 check (recipient_kind in ('user', 'moderator', 'trust_admin', 'admin')),

  status         text not null default 'pending'
                 check (status in ('pending', 'sent', 'failed', 'skipped')),

  -- Why a send was skipped, or how a delivery failed. Provider text only —
  -- no address, no message body.
  detail         text check (detail is null or char_length(detail) <= 500),

  attempts       int not null default 0 check (attempts >= 0 and attempts <= 20),
  payload        jsonb not null default '{}'::jsonb,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  sent_at        timestamptz
);

create index if not exists notification_events_recipient_idx
  on notification_events (recipient_id, created_at desc);
create index if not exists notification_events_status_idx
  on notification_events (status, created_at desc)
  where status in ('pending', 'failed');
create index if not exists notification_events_kind_idx
  on notification_events (kind, created_at desc);

drop trigger if exists notification_events_set_updated_at on notification_events;
create trigger notification_events_set_updated_at
  before update on notification_events
  for each row execute function set_updated_at();

-- RLS on, no policy. Same setting as `verification_records` and
-- `rate_limit_events`, and for the same reason: no client role has any
-- business reading the delivery log, and a policy could only widen that.
-- Supabase's advisor reports this as `rls_enabled_no_policy`; see 0043 for why
-- that finding is the control working.
alter table notification_events enable row level security;

revoke all on table notification_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Claiming an event
--
-- One statement, so two senders racing on the same event cannot both win.
-- Returns the row id when this caller is the one that must send, and nothing
-- at all when somebody already has.
-- ---------------------------------------------------------------------------

create or replace function livd_claim_notification(
  target_key     text,
  target_kind    text,
  target_user    uuid,
  target_channel text,
  target_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  claimed uuid;
begin
  insert into notification_events (dedupe_key, kind, recipient_id, recipient_kind, payload, attempts)
  values (target_key, target_kind, target_user, coalesce(target_channel, 'user'), coalesce(target_payload, '{}'::jsonb), 1)
  on conflict (dedupe_key) do nothing
  returning id into claimed;

  return claimed;
end;
$fn$;

create or replace function livd_settle_notification(
  target_key    text,
  target_status text,
  target_detail text
)
returns void
language sql
security definer
set search_path = public
as $fn$
  update notification_events
     set status  = target_status,
         detail  = left(target_detail, 500),
         sent_at = case when target_status = 'sent' then now() else sent_at end
   where dedupe_key = target_key;
$fn$;

-- ---------------------------------------------------------------------------
-- Where the address comes from
--
-- One row, one person, and only for a caller holding the service role. The
-- preference columns come back with it so the decision "should this be sent"
-- is made from one read rather than two.
-- ---------------------------------------------------------------------------

create or replace function livd_notification_recipient(target_user uuid)
returns table (
  user_id                  uuid,
  email                    text,
  locale                   text,
  status                   user_status,
  email_review_updates     boolean,
  email_property_responses boolean,
  email_trust_safety       boolean
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    p.id,
    u.email::text,
    p.preferred_locale,
    p.status,
    p.email_review_updates,
    p.email_property_responses,
    p.email_trust_safety
  from profiles p
  join auth.users u on u.id = p.id
  where p.id = target_user
    and u.email is not null
    -- A deleted or banned account is not written to. Nothing good comes of
    -- emailing somebody about content on a platform that has removed them.
    and p.status <> 'banned';
$fn$;

-- ---------------------------------------------------------------------------
-- Operational recipients
--
-- Staff by role rather than by a hard-coded address. An address in an
-- environment variable is one person's inbox, and it is wrong the week they
-- go on holiday.
--
-- `min_rank` follows the ladder in src/server/auth/guards.ts: moderator 1,
-- trust_admin 2, admin 3. Higher roles receive what lower roles receive,
-- because an escalation nobody senior sees is not an escalation.
-- ---------------------------------------------------------------------------

create or replace function livd_notification_staff(min_rank int)
returns table (user_id uuid, email text, role user_role)
language sql
stable
security definer
set search_path = public
as $fn$
  select p.id, u.email::text, p.role
  from profiles p
  join auth.users u on u.id = p.id
  where p.status = 'active'
    and u.email is not null
    and case p.role
          when 'moderator'   then 1
          when 'trust_admin' then 2
          when 'admin'       then 3
          else 0
        end >= greatest(min_rank, 1)
  order by p.created_at
  -- A cap, so a misconfiguration cannot turn one report into a thousand
  -- emails. Livd will not have more than fifty staff accounts, and if it ever
  -- does, operational mail should be going to a shared inbox rather than to
  -- everybody.
  limit 50;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants
--
-- The default grant on a new function is EXECUTE to PUBLIC — 0006 is the
-- migration that exists because that was missed once. All four come off
-- `public`, `anon` and `authenticated`; `service_role` reaches them as the
-- owner-equivalent role Supabase gives the service key.
-- ---------------------------------------------------------------------------

revoke execute on function livd_claim_notification(text, text, uuid, text, jsonb)
  from public, anon, authenticated;
revoke execute on function livd_settle_notification(text, text, text)
  from public, anon, authenticated;
revoke execute on function livd_notification_recipient(uuid)
  from public, anon, authenticated;
revoke execute on function livd_notification_staff(int)
  from public, anon, authenticated;

grant execute on function livd_claim_notification(text, text, uuid, text, jsonb) to service_role;
grant execute on function livd_settle_notification(text, text, text)            to service_role;
grant execute on function livd_notification_recipient(uuid)                     to service_role;
grant execute on function livd_notification_staff(int)                          to service_role;
