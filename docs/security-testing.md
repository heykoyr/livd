# Livd — security testing

Two halves, and neither substitutes for the other.

**In the test suite.** `tests/safety/role-escalation.test.ts` and the other
`tests/safety/` files run against the local adapter, in process, on every
commit. They pin the *rules*: who may grant a role, what a refusal says, what
gets written to the audit trail. They cannot prove that Postgres enforces any
of it, because they never touch Postgres.

**Against the database.** The controls that actually protect production are row
level security, column privileges and triggers, and the only way to know those
work is to attack the deployed database as each role and watch it refuse. Those
runs are recorded here, with their results, because they are not reproducible
in CI — they need a real Postgres with real policies and a real `auth.uid()`.

Every run below was executed inside a transaction that was deliberately aborted,
so no production row was created, changed or removed. Where a run needed a
moderator and none existed, one was made inside that same aborted transaction.

---

## Method

Each attack impersonates a signed-in browser session by setting the Postgres
role and the JWT claims PostgREST would set:

```sql
perform set_config('role', 'authenticated', true);
perform set_config('request.jwt.claims',
  json_build_object('sub', <account>, 'role', 'authenticated')::text, true);
```

That is the same context a request carrying the publishable key and a session
cookie arrives in, so a statement that succeeds here succeeds over
`/rest/v1/`, and one that fails here fails there.

The refusal **message** is recorded, not just the SQLSTATE. This turned out to
matter more than expected — see the note on false passes at the end.

---

## 2026-09-09 · Phase 1A · moderator → admin escalation

Migrations under test: `0019_trust_admin_role`, `0020_close_role_escalation`,
`0021_restore_policy_predicate_grants`.

### Before the fix

| # | Attack | Result |
|---|---|---|
| 0 | Session at moderator-or-above rewrites `profiles.role` on **another** account | **PERMITTED — 1 row.** The escalation was real. |

Reproduced by a no-op write (`set role = role`), so the measurement was whether
RLS admitted the statement, not what it would have changed. The exploit needed
no application code: `PATCH /rest/v1/profiles?id=eq.<self>` with
`{"role":"admin"}`.

Unexploited at the time only because the deployment had one administrator and
no moderator accounts. It would have armed itself the day a moderator was
appointed.

### After the fix

| # | Attack | Result | Which control refused it |
|---|---|---|---|
| 1 | Moderator promotes **themselves** to admin via PostgREST | BLOCKED | column privilege |
| 2 | Moderator promotes **another account** to admin via PostgREST | BLOCKED | column privilege |
| 3 | Resident promotes themselves to moderator | BLOCKED | column privilege |
| 4 | Resident rewrites their own `status` | BLOCKED | column privilege |
| 5 | **Service role** writes `role` directly | BLOCKED | trigger |
| 6 | Moderator calls `livd_set_user_role` | BLOCKED | `Only an administrator may change a role` |
| 7 | Administrator changes their **own** role | BLOCKED | `You cannot change your own role` |
| 8 | Administrator grants a role with a blank reason | BLOCKED | `A reason is required, for the audit trail` |
| 9 | Administrator grants a role with a reason | **Applied**, 1 audit row | — |
| 9b | The identical grant retried | Still 1 audit row | idempotent |
| 10 | Service role **deletes** its own audit trail | BLOCKED | grant revoked |
| 11 | Service role **rewrites** an audit reason | BLOCKED | grant revoked |

Test 5 is the one worth dwelling on. Every administrative write in this
application uses the service-role client, and the service role bypasses RLS
entirely — so a policy alone would have left `role` writable by any Server
Action. The trigger binds regardless of role, which is what makes
"Server Actions cannot bypass intended authorisation" true rather than
aspirational.

### Nothing legitimate was broken

| # | Behaviour that must survive | Result |
|---|---|---|
| 12 | Resident updates their own `country_code` | 1 row — works |
| 13 | Resident reads `profiles` | 1 row — their own, and only their own |
| 13b | Anonymous visitor reads `profiles` | 0 rows |
| 14 | Anonymous visitor reads active properties | 16 rows — works |

### Production state, after every run

```
profiles 124 · admins 1 · moderators 0 · trust_admins 0 · residents 123
non-active 0 · reviews 222 · properties 16 · audit rows 0
```

Identical to the state before testing began.

---

## A false pass, and what it cost

The first run of the suite above reported tests 1–4 as BLOCKED with SQLSTATE
42501, which is exactly what a correctly refused privilege violation looks
like. They were not being refused by any of the new controls. `0020` had
revoked `EXECUTE` on `livd_is_moderator` from `public`, `anon` and
`authenticated` to close a Supabase linter finding, and a policy expression is
evaluated with the privileges of the role running the query — so `profiles` had
become unreadable and unwritable for everyone, and every attack "failed"
because the table was broken.

It surfaced only because the same run also asserted the things that must keep
working, and test 12 — a resident updating their own country — came back
`permission denied for function livd_is_moderator`.

Two things changed as a result:

1. `0021` restores the grants and explains why the revoke was wrong. The linter
   finding is accepted and documented instead: the predicates answer only
   "what am I" about `auth.uid()`, take no subject and return no data. Moving
   them to a schema PostgREST does not expose is the real remedy and is
   recorded as follow-up hardening.
2. Every attack in this document records the refusal **message**, not just the
   SQLSTATE. A control that cannot be told apart from an outage is not a
   control, and a security test that cannot tell them apart is worse than none
   — it manufactures confidence.

The earlier probe that led to the mistake was itself faulty: it revoked from
`authenticated` only, leaving the `PUBLIC` grant intact, so the function stayed
callable and the policy kept evaluating. It proved nothing and looked like it
proved something.
