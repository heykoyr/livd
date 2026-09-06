-- ===========================================================================
-- Livd — 0008 · Close two functions that were still reachable over the API
--
-- 0006 established the rule: a function no client calls should not be an HTTP
-- endpoint. Re-running the linter after seeding showed two that slipped past
-- it, and the reason is worth writing down because it will happen again to
-- anything added later.
--
-- `revoke execute ... from public` is not sufficient on Supabase. Alongside
-- PostgreSQL's own grant to PUBLIC, the project's default privileges grant
-- EXECUTE *directly* to `anon`, `authenticated` and `service_role` on every
-- new function in `public`. Revoking from PUBLIC removes one of those four
-- grants and leaves the other three. 0005 happened to revoke from `anon` and
-- `authenticated` as well — which is why the functions it covered are clean
-- and the two added afterwards are not.
--
-- Neither was exploitable. `livd_sync_property_claimed` is a trigger function
-- and raises immediately when called any other way, and `livd_demo_uuid` is a
-- pure hash of its argument. Both are still closed: an endpoint that exists
-- for no reason is one more thing to reason about.
-- ===========================================================================

-- Trigger function, added in 0007. PostgreSQL does not check EXECUTE when a
-- trigger fires, so revoking it removes the endpoint and nothing else —
-- verified in 0005 against the triggers it covered.
revoke execute on function livd_sync_property_claimed()
  from public, anon, authenticated;

-- Seeding helper: mirrors the id derivation in scripts/seed-supabase.mjs so
-- the two cannot disagree. Only ever called from a migration or a seed.
revoke execute on function livd_demo_uuid(text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Still executable by anon and authenticated, deliberately
--
-- The three policy helpers, for the reason recorded in 0005 and 0006: an RLS
-- policy expression is evaluated as the querying role, so revoking EXECUTE
-- would make every policy that calls one of them fail. Each discloses exactly
-- one fact about the caller and nothing about anyone else.
--
-- `livd_property_search` too — the application calls it as an RPC. It is
-- SECURITY INVOKER, so RLS still applies to everything it reads.
-- ---------------------------------------------------------------------------

comment on function livd_is_active_user() is
  'Used inside RLS policies, so it must remain executable by anon and authenticated — a policy is evaluated as the querying role. Discloses only whether the caller''s own account is in good standing.';

-- ---------------------------------------------------------------------------
-- Advisories left open after this migration, and why
--
-- rls_enabled_no_policy on `rate_limit_events` and `verification_records` —
--   deliberate, and the point. RLS on with no policy denies every client role
--   outright. Nothing but the service role should ever read either table.
--
-- extension_in_public for `pg_trgm` and `unaccent` — Supabase installs both
--   there. `livd_property_search` resolves their operators against a pinned
--   `search_path = public`; relocating them would break it for no gain.
--
-- Leaked Password Protection Disabled — not applicable. Livd has no password
--   authentication: `signInWithOtp` is the only sign-in path in the codebase,
--   so there is no password for HaveIBeenPwned to check. Worth revisiting only
--   if a password flow is ever added.
-- ---------------------------------------------------------------------------
