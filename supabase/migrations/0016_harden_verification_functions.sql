-- ===========================================================================
-- Livd — 0016 · Hardening for the verification functions
--
-- Raised by the Supabase database linter after 0013–0015, and one of the
-- findings is a regression rather than a new gap: `create or replace function`
-- DROPS a function's pinned `search_path`. 0014 replaced
-- `livd_verification_weight` to teach it the new level and silently undid the
-- `alter function ... set search_path` that 0005 had applied to it.
--
-- Worth recording rather than just fixing, because it will happen again to
-- whoever next replaces a hardened function — and it fails silently, which is
-- the property that makes it worth a paragraph.
--
-- Everything below follows the pattern 0005 and 0006 established. Note in
-- particular that revoking from `anon, authenticated` alone achieves nothing:
-- PostgreSQL grants EXECUTE on every new function to PUBLIC and both roles
-- inherit it. That mistake is the entire subject of 0006.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Pin search_path
--
-- A function without a pinned search_path resolves unqualified names against
-- whatever the caller's happens to be. For the SECURITY INVOKER functions here
-- that is a small risk — they run as the caller, who gains nothing by
-- redirecting a name to their own object — but the pattern is the control, and
-- a schema where some functions are pinned and some are not is a schema where
-- nobody can tell at a glance which is which.
-- ---------------------------------------------------------------------------

alter function livd_verification_weight(verification_level)          set search_path = public;
alter function livd_earth_radius_meters()                            set search_path = public;
alter function livd_haversine_meters(numeric, numeric, numeric, numeric) set search_path = public;
alter function livd_verification_radius_meters(char)                 set search_path = public;
alter function livd_proximity_budget_meters(numeric, char, numeric)  set search_path = public;
alter function livd_properties_near(numeric, numeric, numeric, integer) set search_path = public;

-- ---------------------------------------------------------------------------
-- 2. Take the RPC endpoints away from functions that are not endpoints
--
-- PostgREST publishes everything in `public`, so a trigger function is an HTTP
-- endpoint until someone says otherwise. PostgreSQL does not check EXECUTE when
-- a trigger fires, so this removes the endpoint at no cost to the trigger —
-- the same reasoning, and the same verification, as 0005.
--
-- `livd_derive_review_verification` is the important one. It is SECURITY
-- DEFINER, and while calling it outside a trigger context would error rather
-- than do anything useful, a SECURITY DEFINER function reachable over HTTP by
-- an anonymous caller is not a thing to leave lying around next to the table it
-- was written to protect.
--
-- The two budget functions go as well. They are only ever called from inside
-- `livd_verify_property_location`, which runs as its owner and keeps its own
-- privilege, and leaving them callable would publish Livd's exact verification
-- tuning to anyone wanting to arrange a position just inside it.
-- ---------------------------------------------------------------------------

revoke execute on function livd_derive_review_verification()         from public, anon, authenticated;
revoke execute on function livd_verification_radius_meters(char)     from public, anon, authenticated;
revoke execute on function livd_proximity_budget_meters(numeric, char, numeric)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. What deliberately keeps its grant, and why
--
-- Two functions stay reachable on purpose, and both are recorded on the
-- function itself so the next person reading a linter warning finds the
-- decision rather than re-litigating it.
-- ---------------------------------------------------------------------------

comment on function livd_haversine_meters(numeric, numeric, numeric, numeric) is
  'Pure geometry over values the caller already holds. Executable by clients because livd_properties_near is SECURITY INVOKER and calls it as the visitor; revoking would break nearby discovery for signed-out readers. Discloses nothing and reads no table.';

comment on function livd_verify_property_location(uuid, numeric, numeric, numeric, timestamptz) is
  'Decides whether the caller is at a property. Takes a position as arguments and stores none of it. SECURITY DEFINER and granted to authenticated on purpose: it exists to make a verdict rather than accept one, and this deployment has no service-role key for a Server Action to use instead. The linter flags it; that is expected, and this is the record of the decision.';
