-- ===========================================================================
-- Livd — 0041 · Privileges nobody asked for
--
-- Also from the Phase 13 review, and a different kind of finding from 0040:
-- nothing here is exploitable through anything Livd exposes. It is excess
-- privilege, sitting there because a platform default put it there.
--
-- WHAT WAS FOUND
--
-- `anon` and `authenticated` held TRUNCATE on 32 tables, TRIGGER on 40 and
-- REFERENCES on 39 — Supabase's default `grant all` for the public schema,
-- which every table inherits unless somebody says otherwise.
--
-- TRUNCATE is the one that matters, because **TRUNCATE is not filtered by Row
-- Level Security**. Every other write a client role can attempt is checked row
-- by row against a policy; TRUNCATE removes every row without consulting one.
-- The entire protection model of this database is RLS, and here is a verb it
-- does not cover, granted to the role an unauthenticated visitor uses.
--
-- WHY IT IS NOT AN EMERGENCY
--
-- PostgREST maps HTTP to SELECT, INSERT, UPDATE and DELETE. There is no verb
-- that reaches TRUNCATE, so the grant is not reachable through the API, and
-- the anon key is a signing key for that API rather than a database password.
-- Running the attack found it blocked twice over anyway — by a foreign key on
-- `reviews`, and by `review_snapshots` lacking the same grant, which stopped
-- the cascade.
--
-- WHY IT IS BEING FIXED ANYWAY
--
-- "Not reachable through the interface we currently expose" is precisely the
-- reasoning that let a moderator promote themselves to administrator until
-- 0020. That hole was also unreachable — through the UI. The privilege was
-- real, and one day something else would have reached it.
--
-- A client role has no use for TRUNCATE, for creating triggers, or for making
-- foreign keys to a table. Removing them costs nothing and removes a class of
-- question rather than an instance of one.
-- ===========================================================================

revoke truncate, trigger, references on all tables in schema public
  from anon, authenticated;

-- And for tables that do not exist yet. Without this, the next `create table`
-- inherits exactly what this migration just removed, and the finding returns
-- silently with the next feature.
alter default privileges in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;

-- ---------------------------------------------------------------------------
-- What deliberately stays
--
-- SELECT, INSERT, UPDATE and DELETE remain granted to the client roles on most
-- tables, which looks alarming next to the above and is not the same thing.
-- Those four are the verbs PostgREST issues, and every one of them is filtered
-- row by row by a policy — a client with UPDATE on `reviews` can still only
-- touch a row `reviews_update_own` lets them touch. That is the Supabase model
-- working as designed.
--
-- The tables where even that was too much — `admin_audit_log`,
-- `moderation_actions`, `disclosure_records`, `account_signals`,
-- `case_evidence` and the rest of the Trust & Safety area — had those grants
-- removed in the migration that created them, because for those, "a policy
-- will catch it" is not a good enough answer.
-- ---------------------------------------------------------------------------
