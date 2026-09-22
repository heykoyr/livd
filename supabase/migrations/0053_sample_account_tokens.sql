-- ===========================================================================
-- Livd — 0053 · Sample accounts that Auth can read
--
-- The 121 sample accounts were created by `scripts/build-seed-sql.mjs`, which
-- inserted into `auth.users` directly and left four token columns NULL. Auth
-- itself always writes an empty string there and scans those columns as
-- strings, so a NULL in any row makes every admin user listing fail with
-- "Database error finding users" — for the whole project, not just the sample
-- rows. That is the API the Supabase dashboard's user list, and the sample-data
-- loader, both depend on.
--
-- Found when the loader's first call failed. Real accounts were never
-- affected: Auth created them, and every one already holds ''.
--
-- The fix sets exactly what Auth would have set, and only on the sample
-- accounts — the reserved `demo.livd.invalid` domain, which can never be a
-- real person's address. `build-seed-sql.mjs` now writes the same values, so
-- the defect cannot come back through it.
-- ===========================================================================

update auth.users
set
  confirmation_token     = coalesce(confirmation_token, ''),
  recovery_token         = coalesce(recovery_token, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change           = coalesce(email_change, '')
where email like '%@demo.livd.invalid'
  and (
    confirmation_token is null
    or recovery_token is null
    or email_change_token_new is null
    or email_change is null
  );
