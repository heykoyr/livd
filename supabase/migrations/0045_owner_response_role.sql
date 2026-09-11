-- ===========================================================================
-- Livd — 0045 · Making the right of reply actually work
--
-- Claiming a property is supposed to grant one thing: a public reply to each
-- review of it. The Server Action existed, the RLS policy existed, the
-- component that renders a response existed. The feature did not work, for
-- two reasons, and neither was the one it looked like.
--
-- ONE: THE RESPONSE COULD NEVER BE READ BACK
--
-- `listPublicReviews` fetched responses with
--
--     .select('id, review_id, body, is_resolution_notice, created_at,
--              property_claims!inner(role_claimed)')
--
-- and there is no foreign key between `owner_responses` and
-- `property_claims`. PostgREST answers that with
--
--     400 PGRST200 · Could not find a relationship between 'owner_responses'
--     and 'property_claims' in the schema cache
--
-- and the adapter destructured `{ data: responses }` without `error`, so the
-- failure was discarded and `responses` was null. Every property page in
-- production has been rendering as though no property had ever replied.
-- Verified by running the query against the live database as `anon`, which is
-- how it was found — the local adapter has no PostgREST and could not fail
-- this way.
--
-- The join existed to recover the responder's role. This migration makes that
-- unnecessary by storing it.
--
-- TWO: NOTHING EVER CALLED THE ACTION
--
-- `submitOwnerResponse` had no caller anywhere in the application. That half
-- is fixed in the UI, not here.
--
-- WHY A COLUMN RATHER THAN A JOIN
--
-- The role a responder holds is a fact about the moment they replied. A
-- managing agent who replies in March and is replaced in June should still be
-- shown as the agent on the March reply — a live join would silently rewrite
-- the attribution on every historical response the day a claim changed hands.
--
-- It is filled by a trigger, never by the client. The same rule as
-- `verification_level` in 0014: a value the reader is asked to trust is
-- derived by the database from a record it can check, not accepted from
-- whoever is writing.
-- ===========================================================================

alter table owner_responses
  add column if not exists respondent_role claim_role;

-- ---------------------------------------------------------------------------
-- Backfill
--
-- Safe to run repeatedly, and correct for every response written before this
-- migration: at most one claim per property is approved at a time, so the
-- approved claim is unambiguous.
-- ---------------------------------------------------------------------------

update owner_responses r
   set respondent_role = c.role_claimed
  from property_claims c
 where r.respondent_role is null
   and c.property_id = r.property_id
   and c.claimant_id = r.responder_id
   and c.status = 'approved';

-- Anything still null belongs to a responder whose claim was later revoked or
-- whose account is gone. `manager` is the neutral reading of "somebody who
-- spoke for the property", and the response stays up either way.
update owner_responses set respondent_role = 'manager' where respondent_role is null;

alter table owner_responses alter column respondent_role set not null;

-- ---------------------------------------------------------------------------
-- The trigger
--
-- Derives the role from the approved claim and overwrites whatever was
-- submitted. The insert policy already requires `livd_owns_property`, so by
-- the time this runs the claim is known to exist; the coalesce is for the
-- service role, which policies do not bind.
-- ---------------------------------------------------------------------------

create or replace function livd_derive_respondent_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  select c.role_claimed
    into new.respondent_role
    from property_claims c
   where c.property_id = new.property_id
     and c.claimant_id = new.responder_id
     and c.status = 'approved'
   limit 1;

  new.respondent_role := coalesce(new.respondent_role, 'manager');
  return new;
end;
$fn$;

drop trigger if exists owner_responses_derive_role on owner_responses;
create trigger owner_responses_derive_role
  before insert on owner_responses
  for each row execute function livd_derive_respondent_role();

-- A trigger function has no business in anybody's API surface. 0043 is the
-- migration that exists because this was forgotten once.
revoke execute on function livd_derive_respondent_role() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The column grant
--
-- `owner_responses` still holds a table-level SELECT grant, so a new column is
-- readable without being named — unlike `reviews`, where 0040 traded the
-- table grant for column grants. Stated here so that the difference between
-- the two tables is deliberate rather than discovered.
--
-- Writing it is a different matter: `respondent_role` is set by the trigger
-- above, so an INSERT that names it is overwritten rather than refused. That
-- is the safer direction — a client asserting `respondent_role = 'owner'`
-- changes nothing.
-- ---------------------------------------------------------------------------

comment on column owner_responses.respondent_role is
  'The role the responder held when they replied. Derived by trigger from the approved claim; never accepted from a client.';
