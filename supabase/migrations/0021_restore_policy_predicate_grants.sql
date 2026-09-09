-- ===========================================================================
-- Livd — 0021 · Give the policy predicates their EXECUTE grant back
--
-- 0020 revoked EXECUTE on `livd_is_moderator`, `livd_is_active_user` and
-- `livd_owns_property` from `public`, `anon` and `authenticated`, to close a
-- Supabase linter finding about SECURITY DEFINER functions being callable over
-- `/rest/v1/rpc`. That was wrong, and this migration undoes it.
--
-- WHY IT WAS WRONG
--
-- A row-level-security policy expression is evaluated with the privileges of
-- the role running the query, not the table owner's. Every policy in this
-- schema calls at least one of these three, so taking the grant away did not
-- make the functions unreachable — it made the *tables* unreachable. A signed-
-- in resident updating their own country got `permission denied for function
-- livd_is_moderator`, because `profiles`'s policies could no longer be
-- evaluated at all.
--
-- Worse than the breakage: it made the security tests lie. An attacker's write
-- was refused with SQLSTATE 42501, which is exactly what a correctly blocked
-- privilege violation looks like — so four escalation tests reported BLOCKED
-- while proving nothing about the controls they were supposed to be exercising.
-- A control that cannot be distinguished from an outage is not a control.
--
-- This was checked before 0020 was written and the check was faulty: the probe
-- revoked from `authenticated` only, leaving the `PUBLIC` grant in place, so
-- the function stayed callable and the policy kept evaluating. 0020 revoked
-- `PUBLIC` as well, which is what actually removed the privilege.
--
-- WHAT THE LINTER FINDING ACTUALLY AMOUNTS TO
--
-- Each of these answers exactly one question — "what am I" — about
-- `auth.uid()` and nobody else:
--
--   livd_is_moderator()     may the caller moderate
--   livd_is_active_user()   is the caller's own account in good standing
--   livd_is_trust_admin()   may the caller cross the identity boundary
--   livd_is_super_admin()   may the caller grant roles
--   livd_owns_property(id)  does the caller hold the approved claim on this
--
-- Calling one tells you something you already knew about yourself. None takes
-- a subject, none can be pointed at another account, and none returns data.
-- The finding is real in the sense that the endpoints exist; it is not a
-- disclosure.
--
-- The proper remedy is to move these predicates into a schema PostgREST does
-- not expose, so policies keep calling them while `/rest/v1/rpc` cannot. That
-- means rewriting every policy in the schema that references them, which is
-- not something to do inside an emergency fix for an escalation path. It is
-- recorded as follow-up hardening in the final report.
-- ===========================================================================

grant execute on function livd_is_moderator()      to public, anon, authenticated;
grant execute on function livd_is_active_user()    to public, anon, authenticated;
grant execute on function livd_owns_property(uuid) to public, anon, authenticated;

-- The two predicates 0020 introduced. They are not in any policy yet — the
-- identity boundary lands in a later phase — but they will be, and they will
-- fail the same way if the grant is missing when that happens.
grant execute on function livd_is_trust_admin()    to anon, authenticated;
grant execute on function livd_is_super_admin()    to anon, authenticated;

comment on function livd_is_trust_admin() is
  'True for trust_admin and admin. The identity boundary: everything this gates is audited. Callable over RPC because RLS policies evaluate it with the caller''s privileges; it discloses nothing, answering only "what am I".';

-- Deliberately NOT restored: `livd_guard_profile_privileged_columns`,
-- `livd_forbid_mutation`, `livd_set_user_role` and `livd_set_user_status`.
--
-- The first two are trigger functions. A trigger is fired by the system as
-- part of a write the caller was already permitted to make, and runs with the
-- trigger owner's rights — it is never resolved against the caller's ACL the
-- way a policy predicate is. They stay unreachable.
--
-- The last two are granted to `authenticated` and to nothing else, on purpose:
-- they are the sanctioned write paths, they derive the actor from `auth.uid()`
-- and they enforce the hierarchy themselves.
