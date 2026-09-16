# HTTP security checks

The two suites that could not be run when Phase 13 was written, because that
session had no outbound network. They attack the deployed system over the wire,
as an anonymous visitor holding nothing but the publishable key that ships in
every browser bundle.

```bash
node scripts/security/http-postgrest.mjs                          # the database's HTTP surface
node scripts/security/http-app.mjs                                # the deployed application
node --env-file=.env.local   scripts/security/notification-contract.mjs                      # the RPC contract 0044 depends on
```

`review-edit-matrix.sql` runs the review-correction matrix: the same seven
authorisation cases as `tests/safety/review-editing.test.ts`, plus what a
correction must not be able to reach, as `authenticated` and as `anon`. It picks
its own fixtures and needs no ids set. The finding it was written after is in
`docs/security-testing.md` under "Phase 21" — three columns of `reviews` that
were writable by their author because the update guard was a blocklist.

`role-escalation-matrix.sql` is the one that has to be run as somebody. The
other suites hold the anon key, which is the right instrument for "what can an
outsider reach" and the wrong one for the escalation bug 0020 closed — that
attacker was a moderator Livd had deliberately given an account to, and no
amount of anonymous probing finds them. This simulates the session instead of
holding one: `set local role authenticated` plus a `request.jwt.claims` naming
the actor, which is exactly what PostgREST does per request, so the attacks meet
the same grants, policies and triggers a real moderator would. Nine cases —
self-promotion, lateral promotion, the privileged RPC, forging the
`livd.privileged_write` GUC the trigger reads, a trust admin reaching for super
admin, resident and owner self-edits, re-inserting your own profile row as an
admin, and a control asserting the legitimate write still works. It picks its
own accounts and needs no ids set.

`owner-response-matrix.sql` runs beside them, in the SQL editor or through
`supabase db query`. Seventeen cases against the live database, as
`authenticated` and as `anon`: who may post a property response, who may not,
and what a response does *not* come with — editing the review, removing it,
reading `author_id`, revealing the reviewer. It commits nothing; the final
`raise` aborts the transaction and the results come back in the error message.
Set the four ids at the top first; the query that finds them is in the header.

`http-postgrest.mjs` reads `.env.local` for the project URL and the anon key.
`http-app.mjs` defaults to production; override with `LIVD_BASE_URL`.

Both are read-only apart from writes that are *expected to be refused* — a
`POST` to `profiles`, a `PATCH` setting `role=admin`, a `DELETE` against the
audit log. If any of those ever succeeds the suite fails, which is the point.
Nothing here mutates anything on a healthy system.

`notification-contract.mjs` is the odd one out: it checks a contract rather
than a control. The adapter reaches the notification functions by RPC, so
argument and column names live in strings that nothing typechecks, and the
suite runs against the local adapter, which has no Postgres. A renamed
parameter would pass every gate and fail on the first review published. It
writes one ledger row and deletes it.

Every check prints `OK` or `FAIL` with the server's own response, so a failure
names the control that stopped holding. The full write-up, including what each
attack is actually trying to do, is in `docs/security-testing.md` under
"Phase 13, part 8".
