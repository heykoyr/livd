-- ===========================================================================
-- Livd — 0040 · Closing the author pseudonym
--
-- Found by the Phase 13 security review, and the most serious thing it found.
--
-- THE FINDING
--
-- `reviews.author_id` was readable by every client role, including `anon`. A
-- single unauthenticated request —
--
--     GET /rest/v1/reviews?select=author_id,property_id,moved_in_month
--
-- — returned an account identifier for all 222 published reviews, resolving to
-- 120 distinct authors. An approved property owner ran the same query against
-- their own building and got the pseudonym behind all 23 reviews of it.
--
-- No email, no name: a UUID. It is tempting to file that as "pseudonymous, not
-- identifying", and that would be the wrong conclusion.
--
-- Livd's promise is that a review is anonymous to the public. Anonymity is not
-- only "your name is not printed"; it is also that two reviews cannot be tied
-- to the same person. A stable per-author key attached to every published
-- review breaks the second half completely. With it, anybody can:
--
--   * group every review one person has ever written, across every building
--     and every city;
--   * cross those with tenure dates, rent, locality and departure reasons,
--     which together are frequently unique to one household;
--   * confirm a guess. An owner who knows a tenant left in March 2023 paying
--     £1,450 can already narrow 23 reviews to one — and the author id then
--     tells them which *other* buildings that same person reviewed, which is
--     often the detail that turns a suspicion into a certainty.
--
-- The brief for this work is explicit that an owner must never reach a
-- reviewer's identity merely because they own the property. The identity
-- itself was well defended — `livd_reveal_user_identity` refused them, the
-- directory refused them, `auth.users` refused them. This was the correlation
-- key that made the defended thing inferable, sitting in the open.
--
-- THE FIX
--
-- Column-level privilege, which is the only mechanism that can express "this
-- row is readable and this column of it is not". RLS decides rows; grants
-- decide columns. Nothing else in the stack can draw that line.
--
-- Server code is unaffected: it reads reviews through the service role, which
-- column privileges do not bind, and every such path is already behind an
-- authentication guard.
--
-- WHAT STILL WORKS, AND WHY
--
-- The three client-session queries that referenced the column were checked one
-- at a time rather than moved wholesale, because a column privilege applies to
-- every reference including a WHERE clause:
--
--   the account's own reviews   moved to the service role; the server passes
--                               the authenticated user's own id and nothing
--                               else
--   the duplicate-tenancy check same
--   editing your own review     the `.eq('author_id', …)` filter was only ever
--                               a friendly error. `reviews_update_own` is the
--                               control, and it still enforces author,
--                               published status and the 24-hour window. A
--                               policy expression is added by the system and
--                               is not subject to the caller's column
--                               privileges, so it keeps working with the grant
--                               removed. Verified, not assumed — 0021 is what
--                               happens when that kind of thing is assumed.
--
-- ALSO HERE: REPORTING YOUR OWN REVIEW
--
-- A smaller finding from the same pass. `reports_insert` checked only that the
-- reporter is the caller and active. "You cannot report your own review" lived
-- in a Server Action, and PostgREST does not run Server Actions — so the check
-- was decorative from outside the application, exactly like the role column
-- before 0020.
--
-- It is a trigger rather than a policy because it needs to read the review the
-- report points at, and because a trigger binds the service role too.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The column
--
-- A published review is public — its text, its rating, its tenure. Who wrote
-- it never was.
--
-- WHY THIS IS A REVOKE AND A RE-GRANT RATHER THAN ONE LINE
--
-- The obvious spelling is
--
--     revoke select (author_id) on table reviews from anon, authenticated;
--
-- and it does nothing at all. A table-level `SELECT` grant covers every column
-- including ones later revoked at column level, so while the blanket grant
-- stands the column revoke is silently inert. That was written, applied, and
-- found to have changed nothing only because the attack was re-run afterwards:
-- anon still read all 222 author ids.
--
-- So the table grant comes off and the columns go back on one by one. It is
-- more to maintain — a column added to `reviews` later is unreadable by
-- clients until it is added here, which will look like a bug to whoever hits
-- it — and that cost is worth paying for the one guarantee it buys. The
-- failure direction is also the safe one: forget a column and a page breaks
-- loudly, rather than an identifier quietly staying readable.
--
-- `tests/safety/author-pseudonym.test.ts` compares this list against the live
-- table so the omission is found by the suite rather than by a user.
-- ---------------------------------------------------------------------------

revoke select on table reviews from anon, authenticated;

grant select (
  id, property_id, residency_status, moved_in_month, moved_out_month,
  tenure_months, overall_rating, body, would_recommend, rent_amount_minor,
  rent_currency, rent_period, noticed_management_change, verification_level,
  status, safety_flags, helpful_count, is_demo, created_at, updated_at,
  verification_id, verified_at
) on table reviews to anon, authenticated;

comment on column reviews.author_id is
  'Never readable by a client role. Revoked in 0040: a stable per-author key on a public row lets anybody group everything one person has written, which is the half of anonymity that is not about names. Server code reads it through the service role.';

-- ---------------------------------------------------------------------------
-- Reporting your own review
-- ---------------------------------------------------------------------------

create or replace function livd_guard_self_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  author uuid;
begin
  select author_id into author from reviews where id = new.review_id;

  if author is not null and author = new.reporter_id then
    raise exception 'You cannot report your own review' using errcode = '42501';
  end if;

  return new;
end;
$fn$;

drop trigger if exists review_reports_no_self_report on review_reports;

create trigger review_reports_no_self_report
  before insert on review_reports
  for each row execute function livd_guard_self_report();

comment on function livd_guard_self_report() is
  'Refuses a report filed by the review''s own author. A trigger rather than a policy: it reads another table, and it binds the service role too.';
