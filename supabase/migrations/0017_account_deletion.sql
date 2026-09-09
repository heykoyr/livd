-- ===========================================================================
-- Livd — 0017 · Account deletion, and making the schema keep the promise
--
-- All three legal pages state that deleting a Livd account removes the account
-- and leaves published reviews standing, permanently unlinked from their
-- author. The reasoning given is that the property record is what the next
-- renter relies on, and a record that can be withdrawn later is not a record.
--
-- The schema did the opposite:
--
--     author_id uuid not null references profiles(id) on delete cascade
--
-- Deleting a profile deleted that person's reviews — and, by cascade, their
-- category ratings, departure reasons and tags with them. The permanent record
-- the pages describe would lose exactly the parts a departing user
-- contributed. `docs/legal-review.md` §4.1 called this out as the one finding
-- that had to be fixed whatever counsel eventually says, because a published
-- promise and a database that contradicts it cannot both stand.
--
-- This migration makes the database do what the pages say. It is the
-- engineering half; whether "permanently unlinked" is sufficient anonymisation
-- under a given regime is a question for counsel, and nothing here forecloses
-- a stricter answer later.
--
-- ---------------------------------------------------------------------------
-- The principle applied to every link
--
--   A public contribution survives, severed from its author.
--     reviews, owner_responses
--
--   Anything private is destroyed with the account.
--     saved_properties, notifications, helpful votes, property_verifications,
--     verification_records and the evidence files behind them, property_claims
--
--   The moderation record survives, severed.
--     moderation_actions, review_reports, and the three `reviewed_by` columns
--
-- The last group is not sentiment about audit trails. Four foreign keys were
-- `NO ACTION`, which does not mean "leave it alone" — it means the delete is
-- refused. Any moderator who had ever decided anything could never have
-- deleted their account at all, and the failure would have surfaced as an
-- unexplained error at the worst possible moment.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Public contributions: unlink, never delete
-- ---------------------------------------------------------------------------

alter table reviews alter column author_id drop not null;

alter table reviews drop constraint reviews_author_id_fkey;
alter table reviews add constraint reviews_author_id_fkey
  foreign key (author_id) references profiles(id) on delete set null;

comment on column reviews.author_id is
  'Null once the author has deleted their account. The review stays — that is what the legal pages promise — and becomes permanently unattributable. Nothing can re-link it: livd_guard_review_update forbids changing this column, and the insert policy requires author_id = auth.uid(), which no null can satisfy.';

alter table owner_responses alter column responder_id drop not null;

alter table owner_responses drop constraint owner_responses_responder_id_fkey;
alter table owner_responses add constraint owner_responses_responder_id_fkey
  foreign key (responder_id) references profiles(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. The moderation record: unlink, never delete, and never block
-- ---------------------------------------------------------------------------

alter table moderation_actions alter column actor_id drop not null;

alter table moderation_actions drop constraint moderation_actions_actor_id_fkey;
alter table moderation_actions add constraint moderation_actions_actor_id_fkey
  foreign key (actor_id) references profiles(id) on delete set null;

comment on table moderation_actions is
  'Append-only audit log. A decision survives the person who made it: actor_id is nulled when they leave rather than the row being removed, because a moderation history with gaps is not a history.';

alter table review_reports alter column reporter_id drop not null;

alter table review_reports drop constraint review_reports_reporter_id_fkey;
alter table review_reports add constraint review_reports_reporter_id_fkey
  foreign key (reporter_id) references profiles(id) on delete set null;

-- The three `reviewed_by` columns. All were NO ACTION, all would have refused
-- the delete outright.
alter table property_claims drop constraint property_claims_reviewed_by_fkey;
alter table property_claims add constraint property_claims_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id) on delete set null;

alter table property_flags drop constraint property_flags_reviewed_by_fkey;
alter table property_flags add constraint property_flags_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id) on delete set null;

alter table verification_records drop constraint verification_records_reviewed_by_fkey;
alter table verification_records add constraint verification_records_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 3. What is deliberately left as CASCADE
--
--   saved_properties.user_id            a private shortlist
--   notifications.user_id               addressed to a person who is gone
--   review_helpful_votes.voter_id       a private ranking signal
--   property_claims.claimant_id         an assertion by a person, not a record
--   property_verifications.user_id      location-check history, which must not
--                                       outlive the account it describes
--   verification_records.submitted_by   the tenancy document and its hash
--
-- The last one carries a caveat the database cannot enforce: deleting the row
-- does not delete the *file* in the `verification-evidence` bucket. A tenancy
-- agreement carries a name, an address and a signature, and orphaning one in
-- storage would be the single worst outcome of this whole feature. The Server
-- Action removes the objects before it deletes the account; see
-- `deleteAccount` in src/server/actions/account.ts.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4. The unique index still means what it says
--
-- `reviews_one_per_tenancy` covers (property_id, author_id, year). Postgres
-- treats nulls as distinct in a unique index, so orphaned reviews never
-- collide with each other — several people who have since left can each keep a
-- review of the same building in the same year, which is correct. A live
-- account is still held to one review per tenancy, because its author_id is
-- not null.
--
-- Recreated only to carry that reasoning as a comment; the definition is
-- unchanged.
-- ---------------------------------------------------------------------------

comment on index reviews_one_per_tenancy is
  'One review per person, per property, per move-in year. Null author_ids are distinct under a unique index, so reviews orphaned by account deletion never collide.';

-- ---------------------------------------------------------------------------
-- 5. A deleted author cannot be impersonated
--
-- Worth stating explicitly because it is the obvious attack on unlinking: if a
-- review has no author, can somebody claim it?
--
--   reviews_update_own    requires author_id = auth.uid(); null never matches.
--   livd_guard_review_update  forbids changing author_id at all.
--   reviews_insert_self   requires author_id = auth.uid() on insert.
--
-- No policy or grant anywhere permits an UPDATE that sets author_id, so an
-- orphaned review stays orphaned.
-- ---------------------------------------------------------------------------
