-- ===========================================================================
-- Livd — 0043 · What the database linter found
--
-- Supabase's own advisors were run as part of the Phase 14 regression. Most of
-- what they report is this schema working as designed and the linter being
-- unable to tell that; two items were real and are fixed here.
--
-- FIXED: A MUTABLE SEARCH PATH ON THREE FUNCTIONS
--
-- Every `livd_*` function written since 0020 pins `set search_path = public`.
-- Three older ones did not: `livd_mask_email`, `livd_forbid_mutation` and
-- `livd_normalise_audit_action`.
--
-- It matters most for the first two, which run as SECURITY DEFINER. A definer
-- function with an unpinned search path can be made to resolve a name to
-- something the *caller* controls — create `pg_temp.split_part`, call the
-- function, and the definer's rights execute your code. `livd_mask_email` has
-- EXECUTE revoked from every role, and `livd_forbid_mutation` only ever runs as
-- a trigger, so neither is reachable that way today. Pinning them costs one
-- line each and removes the question.
--
-- FIXED: A TRIGGER FUNCTION ANYBODY COULD CALL
--
-- `livd_guard_self_report` was created in 0040 without revoking EXECUTE, so it
-- inherited the default grant to PUBLIC and appeared in the linter as an
-- anon-callable SECURITY DEFINER function. Calling a trigger function directly
-- raises an error rather than doing anything, so nothing was exposed — but a
-- trigger function has no reason to be in anybody's API surface.
--
-- NOT FIXED, AND WHY
--
-- `rls_enabled_no_policy` on `verification_records` and `rate_limit_events`.
-- The linter reads "RLS on, no policies" as an oversight. Here it is the
-- strongest possible setting: with RLS enabled and no policy, **no client role
-- can read a single row**, which is exactly what is wanted for residency
-- documents and rate-limit state. Phase 13 verified it from five different
-- roles, the submitter included. Adding a policy could only widen it.
--
-- `authenticated_security_definer_function_executable`, 57 functions. Every
-- one of them is meant to be callable and refuses the caller internally
-- against `auth.uid()`. That is the architecture: PostgREST exposes the
-- function, the function decides. Phase 13 called a representative sample as
-- residents, owners and moderators and recorded what each refused.
--
-- `anon_security_definer_function_executable`, nine functions. Five are the
-- role predicates that RLS policies call, and 0021 is the migration that
-- exists because revoking EXECUTE on those makes the tables they protect
-- unreadable. Three are the review helpers added in 0042, for the same reason.
-- The ninth was the trigger function fixed above.
--
-- `extension_in_public` — `pg_trgm` and `unaccent` live in `public`. Moving
-- them means rebuilding the search indexes that depend on their operator
-- classes, which is a migration with downtime and no security benefit that
-- this deployment's threat model recognises. Recorded as a known item rather
-- than done quietly.
--
-- `auth_leaked_password_protection` — Livd has no passwords. Sign-in is a
-- magic link or Google. There is nothing for the check to check.
-- ===========================================================================

alter function livd_mask_email(text)             set search_path = public;
alter function livd_forbid_mutation()            set search_path = public;
alter function livd_normalise_audit_action(text) set search_path = public;

revoke execute on function livd_guard_self_report() from public, anon, authenticated;

comment on function livd_guard_self_report() is
  'Refuses a report filed by the review''s own author. A trigger function: it fires on insert and is callable by nobody.';
