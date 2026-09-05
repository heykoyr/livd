-- ===========================================================================
-- Livd — 0006 · Revoke function EXECUTE from PUBLIC
--
-- 0005 revoked EXECUTE from `anon` and `authenticated` and achieved nothing.
-- PostgreSQL grants EXECUTE on every new function to the pseudo-role PUBLIC,
-- and both roles inherit from it — so revoking a grant that was never made
-- directly left the inherited one untouched, and every trigger function was
-- still reachable at /rest/v1/rpc/<name>.
--
-- The linter said so plainly on a re-run, which is the argument for running it
-- again after each fix rather than assuming the fix worked.
-- ===========================================================================

revoke execute on function handle_new_user()                  from public;
revoke execute on function set_updated_at()                   from public;
revoke execute on function livd_reviews_refresh_stats()       from public;
revoke execute on function livd_category_refresh_stats()      from public;
revoke execute on function livd_sync_helpful_count()          from public;
revoke execute on function livd_property_init_stats()         from public;
revoke execute on function livd_guard_profile_self_update()   from public;
revoke execute on function livd_guard_property_update()       from public;
revoke execute on function livd_guard_review_update()         from public;
revoke execute on function livd_round_coordinates()           from public;
revoke execute on function livd_refresh_property_stats(uuid)  from public;

revoke execute on function livd_slugify(text)                 from public;
revoke execute on function livd_rating_to_score(numeric)      from public;
revoke execute on function livd_recency_weight(date)          from public;
revoke execute on function livd_verification_weight(verification_level) from public;

-- The three policy helpers keep EXECUTE, for the reason recorded in 0005.
comment on function livd_is_moderator() is
  'Used inside RLS policies, so it must remain executable by anon and authenticated — a policy is evaluated as the querying role. Discloses only whether the caller is a moderator.';

comment on function livd_owns_property(uuid) is
  'Used inside RLS policies, so it must remain executable. Discloses only whether the caller holds the approved claim on a property.';
