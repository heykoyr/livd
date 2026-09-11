# HTTP security checks

The two suites that could not be run when Phase 13 was written, because that
session had no outbound network. They attack the deployed system over the wire,
as an anonymous visitor holding nothing but the publishable key that ships in
every browser bundle.

```bash
node scripts/security/http-postgrest.mjs     # the database's HTTP surface
node scripts/security/http-app.mjs           # the deployed application
```

`http-postgrest.mjs` reads `.env.local` for the project URL and the anon key.
`http-app.mjs` defaults to production; override with `LIVD_BASE_URL`.

Both are read-only apart from writes that are *expected to be refused* — a
`POST` to `profiles`, a `PATCH` setting `role=admin`, a `DELETE` against the
audit log. If any of those ever succeeds the suite fails, which is the point.
Nothing here mutates anything on a healthy system.

Every check prints `OK` or `FAIL` with the server's own response, so a failure
names the control that stopped holding. The full write-up, including what each
attack is actually trying to do, is in `docs/security-testing.md` under
"Phase 13, part 8".
