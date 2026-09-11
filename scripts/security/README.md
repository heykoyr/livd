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
