-- ===========================================================================
-- Livd — 0005 · Function hardening
--
-- Raised by the Supabase database linter after 0001–0004 were applied to a
-- real project. Two classes of genuine issue, plus advisories that are
-- intentional and documented at the bottom.
--
-- 1. Mutable search_path. A function without a pinned search_path resolves
--    unqualified names against whatever the caller's search_path happens to
--    be. Combined with extensions living in `public`, that is a real
--    privilege-escalation route into any SECURITY DEFINER function.
--
-- 2. Trigger functions exposed as RPC. PostgREST publishes everything in the
--    `public` schema, so `handle_new_user()`, the guard triggers and the stats
--    refresh were all reachable over HTTP. PostgreSQL does not check EXECUTE
--    when a trigger fires, so revoking it removes the endpoint at no cost —
--    verified by inserting a property and confirming all three triggers still
--    ran.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Pin search_path on every function that lacked one
-- ---------------------------------------------------------------------------

alter function set_updated_at()                             set search_path = public;
alter function livd_slugify(text)                           set search_path = public;
alter function livd_rating_to_score(numeric)                set search_path = public;
alter function livd_recency_weight(date)                    set search_path = public;
alter function livd_verification_weight(verification_level) set search_path = public;
alter function livd_property_search(text, char, int, int)   set search_path = public;
alter function livd_round_coordinates()                     set search_path = public;

-- ---------------------------------------------------------------------------
-- 2. Revoke EXECUTE on functions no client ever calls
--
-- Revoking from `anon` and `authenticated` alone does nothing: PostgreSQL
-- grants EXECUTE on every new function to the pseudo-role PUBLIC, and both
-- inherit from it. See 0006, which is where this actually took effect.
-- ---------------------------------------------------------------------------

revoke execute on function handle_new_user()                  from anon, authenticated;
revoke execute on function set_updated_at()                   from anon, authenticated;
revoke execute on function livd_reviews_refresh_stats()       from anon, authenticated;
revoke execute on function livd_category_refresh_stats()      from anon, authenticated;
revoke execute on function livd_sync_helpful_count()          from anon, authenticated;
revoke execute on function livd_property_init_stats()         from anon, authenticated;
revoke execute on function livd_guard_profile_self_update()   from anon, authenticated;
revoke execute on function livd_guard_property_update()       from anon, authenticated;
revoke execute on function livd_guard_review_update()         from anon, authenticated;
revoke execute on function livd_round_coordinates()           from anon, authenticated;
revoke execute on function livd_refresh_property_stats(uuid)  from anon, authenticated;

revoke execute on function livd_slugify(text)                 from anon, authenticated;
revoke execute on function livd_rating_to_score(numeric)      from anon, authenticated;
revoke execute on function livd_recency_weight(date)          from anon, authenticated;
revoke execute on function livd_verification_weight(verification_level) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Deliberately unchanged
--
-- `livd_is_moderator`, `livd_is_active_user` and `livd_owns_property` keep
-- EXECUTE and must. RLS policy expressions are evaluated as the querying role,
-- so revoking EXECUTE on a function a policy references makes every query
-- against that table fail with a permission error. Each discloses only a fact
-- about the caller themselves, which the caller already knows.
--
-- `livd_property_search` keeps EXECUTE — the application calls it as RPC, and
-- it is SECURITY INVOKER, so it returns only what the caller could select
-- anyway.
--
-- `verification_records` and `rate_limit_events` have RLS enabled with no
-- policy. That is the design, not an oversight: RLS on with no policy denies
-- every client role, including the subject of a verification record. Both are
-- reachable only through the service role.
-- ---------------------------------------------------------------------------

comment on table verification_records is
  'Residency and ownership evidence. RLS enabled with no policy, deliberately: no client role may read this, including the subject. Service role only.';

comment on table rate_limit_events is
  'Rate limiting. actor_hash is a salted digest, never a raw IP. RLS enabled with no policy, deliberately: service role only.';
