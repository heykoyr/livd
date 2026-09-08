-- ===========================================================================
-- Livd — 0015 · Take the write grants off property_verifications
--
-- Supabase grants anon and authenticated every privilege on a new table in
-- `public` by default. RLS is what actually denies the writes — there is no
-- insert, update or delete policy on `property_verifications` and there will
-- not be one — but leaning on a single layer is the wrong trade for the one
-- table in the schema whose rows decide whether a badge is real.
--
-- With the grant gone, a policy added in error later cannot become an
-- exploitable write path: the role would still lack the privilege. The only
-- writer stays `livd_verify_property_location`, which is SECURITY DEFINER and
-- runs as the owner.
--
-- SELECT is deliberately left in place. RLS narrows it to the row's own subject
-- and to moderators, which is exactly the intended visibility, and revoking it
-- would break a resident reading back their own verification history.
--
-- Worth stating plainly what this does *not* do: every other table in the
-- schema carries the same default grants and is protected by RLS alone. That is
-- the pattern this project has used since 0004 and it is sound. This table gets
-- the extra layer because it is the root of trust for the verification system,
-- not because the pattern is wrong.
-- ===========================================================================

revoke insert, update, delete, truncate, references
  on table property_verifications
  from anon, authenticated;
