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

## 2026-09-09 · Phase 1B · admin email privacy

Migration under test: `0022_admin_user_directory`.

### Before

`/admin/users` rendered `user.email` for every account. The adapter fetched the
addresses with the service-role key through `auth.admin.listUsers()`, so
everyone the layout guard admitted — moderators included — read all 124 real
addresses, and nothing was recorded because reading one was not modelled as an
act.

It was also wrong. `listUsers({ perPage: limit })` returns accounts in Auth's
own order, which is not the order of the profile page it was zipped against, so
past the first page the addresses shown did not belong to the rows beside them.

### The mask, evaluated in Postgres

| Input | Output |
|---|---|
| `feranmiadekoya@gmail.com` | `fer***@gmail.com` |
| `abcdef@example.com` | `abc***@example.com` |
| `abcd@example.com` | `ab***@example.com` |
| `abc@example.com` | `a***@example.com` |
| `ab@example.com` | `a***@example.com` |
| `a@example.com` | `***@example.com` |
| `null` / `not-an-email` / `@example.com` | `—` |

Never more than half the local part, so a rule tuned for a long address does
not hand back a short one unchanged. `tests/safety/identity.test.ts` holds the
TypeScript copy to this exact table.

### Access

| Attack | Result |
|---|---|
| Anonymous visitor calls `livd_admin_user_directory` | BLOCKED — `permission denied for function` |
| Resident calls `livd_admin_user_directory` | BLOCKED — `Not authorised to read the user directory` |
| Resident calls `livd_admin_find_user_by_email` | BLOCKED — `Not authorised to look up an account` |
| Resident calls `livd_mask_email` directly | BLOCKED — `permission denied for function` |
| Anonymous visitor reads `auth.users` directly | BLOCKED — `permission denied for table users` |
| Moderator-or-above reads page 1 | 5 rows, sample `fer***@gmail.com` |
| ... sees `total_count` | 124 |
| ... reads offset 120 | 4 rows |
| ... asks for 100 000 rows | 100 — capped |

The property that matters most is not in the table. `livd_admin_user_directory`
returns a masked string and no address, so there is no object anywhere in the
Node process holding a real one — it cannot leak into a client payload, a log
line or an error message, because it is not there to leak. A mask applied in
TypeScript would be a promise about what code does with a value it holds; this
is the absence of the value.

---

## 2026-09-09 · Phase 2 · the administrative audit log

Migration under test: `0023_admin_audit_log`.

| Attack / behaviour | Result |
|---|---|
| Entry written by a moderator is stamped with their real id and role | 1 row, `actor_id` and `actor_role` both correct |
| **Moderator** reads `admin_audit_log` directly | 0 rows |
| Resident reads `admin_audit_log` directly | 0 rows |
| Anonymous visitor reads `admin_audit_log` directly | 0 rows |
| Moderator calls `livd_admin_audit_log` | BLOCKED — `Not authorised to read the audit log` |
| Trust & Safety admin calls `livd_admin_audit_log` | 1 row — works |
| Service role **deletes** an entry | BLOCKED — grant revoked |
| Service role **rewrites** an entry | BLOCKED — grant revoked |
| **Table owner** deletes an entry | BLOCKED — `admin_audit_log is append-only` |

Two of these deserve more than a row in a table.

**A moderator cannot read the audit log.** They are among the people it exists
to hold accountable, and a log its subjects can review is a log they can learn
to work around. The case timeline in a later phase is what shows a moderator
the history of work they are entitled to see.

**The table owner is refused too.** The grants stop `service_role` — which is
what every administrative write in this application actually uses — but the
trigger is what stops `postgres`. Append-only enforced by privilege alone would
have left the most privileged connection able to erase the record of what it
did, which is the failure mode the log exists to prevent.

The actor and their role are stamped inside `livd_record_admin_audit` from
`auth.uid()`, never taken as arguments, so an entry cannot be attributed to
somebody who did not perform the action. `actor_role` is captured at write
time rather than joined at read time: a demotion must not rewrite what somebody
was when they did the thing.

---

## 2026-09-09 · Phase 4 · the identity boundary

Migration under test: `0025_identity_reveal`.

| # | Attack / behaviour | Result |
|---|---|---|
| 1 | Moderator calls `livd_reveal_user_identity` | BLOCKED — `requires Trust and Safety authorisation` |
| 2 | Resident calls it, on their own account | BLOCKED — same |
| 3 | Trust admin, made-up reason key | BLOCKED — `Select a reason for this access` |
| 4 | Trust admin, `other` with a three-letter explanation | BLOCKED — `This reason needs a written explanation` |
| 5 | Trust admin, valid category and reason | Address returned; audit rows 0 → 1 |
| 5b | The entry it wrote | `action=identity_revealed outcome=succeeded actor_role=trust_admin`, reason and `caseReference` both present |
| 6 | Does that entry contain an `@` anywhere? | 0 — no address in `reason` or `detail` |
| 7 | Moderator reads `livd_identity_access_history` | 1 row — permitted |
| 8 | Resident reads the same history | BLOCKED — `Not authorised` |

The property worth stating on its own: **the audit insert and the address read
are the same statement block.** There is no ordering in which a disclosure
happens and no record is written — if the insert fails, the transaction aborts
and nothing is returned. Server code could read the address and then log it,
and would be correct almost always; "almost always" is the wrong standard for
the one operation whose entire purpose is accountability.

Row 6 matters more than it looks. An audit log that quotes the email address it
is recording access to has become a second copy of the thing it protects, and
one with a much longer retention.

Row 7 is deliberate asymmetry. A moderator can see *that* an identity was
looked at, by whom and why, while being unable to look themselves. An access
log only its own subjects can read deters nobody.

---

## A fixture that lied

The first run of the reveal tests reported that a **resident successfully
revealed another account's identity**. It was not a hole in the reveal.

The local development adapter makes the first account created in a fresh store
an administrator, so the moderation tools are reachable without a fixture. The
test helper created its "resident" first, and that account was therefore an
admin — so the test named `refuses a resident` was, in fact, checking that an
administrator is allowed.

Two of the earlier suites had the same latent flaw and were passing. Every test
fixture now sets its roles explicitly, `resident` included.

The lesson generalises past this codebase: a security test that leans on a
default is testing the default, not the control. The reason it surfaced at all
is that this suite asserted a refusal rather than only asserting successes.

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

## 2026-09-10 · Phase 5 · Trust & Safety cases

Migrations under test: `0026_trust_safety_cases`, `0027_case_operations`,
`0028_case_lookup_by_id`.

| Behaviour | Result |
|---|---|
| Case opened from a report | `LV-1001 / new / medium` |
| Timeline after opening | 2 events — `created`, `report_linked` |
| Report linked to the case | 1 |
| Subjects inherited from the report's review (review / author) | true / true |
| Opening again from the same report | Returns the same case |
| Concluding with no outcome | BLOCKED — `Say what was decided before closing a case` |
| **Moderator** raising a case to critical | BLOCKED — `requires Trust and Safety authorisation` |
| Assigning a `new` case | Moves it to `open` |
| Full timeline | `created > report_linked > assigned > note_added > status_changed` |
| Open-only listing after resolving | 0 |
| Resident reads `ts_cases` directly | 0 rows |
| Resident reads `case_notes` directly | 0 rows |
| Service role deletes timeline events | BLOCKED — grant revoked |
| **Table owner** rewrites a case note | BLOCKED — `case_notes is append-only` |

Two properties are worth stating on their own.

**Opening a case does nothing to the review.** Not hidden, not flagged, not
touched — verified in `tests/safety/cases.test.ts`, which checks the review's
status, verification level and body are unchanged and that it is still on the
property page. It is the same reasoning that stops a report from removing
anything by itself: if opening a case had a visible effect, opening cases would
become the attack, and anybody who disliked a review would have the lever.

**A case that moved left a timeline entry.** Each `livd_*_case` function writes
its event in the same transaction as the change, so a status that moved without
an event is not a state the database can reach.

### A timeline that lied about its own order

The local adapter gave each timeline event a random id and sorted by timestamp,
then id. Several events are appended inside one `mutate` and share a
millisecond, so the tie-break was effectively random — the full suite caught
`report_linked` sorting before `created`.

Postgres never had the bug: `case_events.id` is a `bigserial`, which is
monotonic. The local store now uses a zero-padded counter for the same reason,
so lexicographic order is chronological order.

Worth recording because of *how* it surfaced: running the case file alone
passed every time. Only the full suite, with different timing, exposed it. A
timeline in the wrong order is not a cosmetic bug — it misrepresents what
happened, which is the one thing a case history exists to get right.

## 2026-09-10 · Phase 6 · the review investigation view

Migration under test: `0029_review_investigation`.

| Attack / behaviour | Result |
|---|---|
| Moderator investigates a review | rating, status, verification, author review count, property review count, reports and cases — one row |
| Resident calls `livd_admin_review_investigation` | BLOCKED — `Not authorised to investigate a review` |
| Anonymous visitor calls `livd_admin_review_verification` | BLOCKED — `permission denied for function` |
| A review whose author deleted their account | Still investigable: `author_id null`, counts 0, verification rows 0 |

The last row is the one that would have broken in production. A deleted account
leaves its reviews standing and permanently unattributable — that is what every
legal page promises — so the investigation view has to keep working with a null
author rather than throwing. Checked in both adapters.

### What the payload cannot contain

`tests/safety/review-investigation.test.ts` performs a real location check from
a real position, then asserts the investigation payload contains none of
`latitude`, `longitude`, `accuracy`, `distance`, or either coordinate value.

That test passes for a structural reason rather than a careful one: the
position is an argument to the verification decision and is gone when it
returns. `property_verifications` has never had a column to put one in. The
test exists to keep it that way.

The same test asserts no email address appears anywhere in the payload — the
author's or the reporter's — and that a claimed property changes nothing about
the review or about what is knowable about its author.

## 2026-09-10 · Phase 7 · evidence preservation

Migration under test: `0030_evidence_preservation`.

| Behaviour | Result |
|---|---|
| Snapshots before any change | 0 |
| Snapshots after removing a review | 1 — `reason=moderation`, `status=published`, body 382 chars, 10 category ratings |
| Snapshots after a moderator rewrites the body | 2 |
| Oldest snapshot still holds the original text | true |
| Service role deletes snapshots | BLOCKED — grant revoked |
| **Table owner** rewrites a snapshot | BLOCKED — `review_snapshots is append-only` |
| Evidence after a correction | 2 items, v1 marked superseded, v2 at version 2 |
| Listing leaks a storage key | 0 |
| Withdrawn item still listed | 1 |
| Case timeline | `created > evidence_added > evidence_added > evidence_withdrawn` |
| Resident reads `review_snapshots` | 0 rows |
| Resident reads `case_evidence` | 0 rows |

The snapshot is taken by a `BEFORE UPDATE` trigger on `reviews`, capturing
`OLD`. That matters more than where it is stored: preservation is not something
a moderation path can forget, because it does not happen on that path at all.
The first snapshot any review gets is the state it was published in.

The audit's finding was that "the original content is preserved" was simply not
true. `setReviewStatus` changed a status and recorded that it had, but kept no
copy — and `livd_guard_review_update` returns `new` unconditionally for a
moderator, so a moderator could rewrite any review body and nothing recorded
what it had said. Both are covered now.

### The unaudited tenancy agreement

`createVerificationEvidenceLink` minted a signed URL to a document carrying a
name, an address and a signature — handed over by somebody whose entire reason
for handing it over was to stay anonymous — and wrote nothing anywhere.

It now runs through the administrative layer: Trust & Safety authorisation, a
written reason, and the audit entry written *before* the link is minted. The
capability moved above moderator deliberately, and so did deciding a residency
verification, because that decision means reading the document. Moderators keep
the queue — the automated checks, the claimed tenancy, whether a document
exists — which is the part that does not require seeing it.

## 2026-09-10 · Phase 8 · user sanctions

Migrations under test: `0031_banned_status`, `0032_user_sanctions`.

| # | Attack / behaviour | Result |
|---|---|---|
| 1 | Moderator restricts | Applied — account `restricted`, 1 audit row |
| 2 | Moderator suspends | BLOCKED — `Suspending an account requires Trust and Safety authorisation` |
| 3 | Trust & Safety admin bans | BLOCKED — `Only an administrator may ban an account` |
| 4 | Trust & Safety admin suspends | Applied — account `suspended` |
| 5 | **The account's review after two sanctions** | `status=published`, body 382 chars — untouched |
| 6 | Anybody sanctions themselves | BLOCKED — `You cannot sanction your own account` |
| 7 | Moderator lifts a suspension | BLOCKED — `Lifting a suspension requires Trust and Safety authorisation` |
| 8 | Lifting the suspension | Falls back to `restricted` — the restriction still standing |
| 9 | Service role deletes sanctions | BLOCKED — grant revoked |
| 10 | The account reads its own sanctions | 2 rows via `livd_my_sanctions` |
| 10b | The same account reads the table directly | 0 rows |

Row 5 is the one that matters most. `profiles.status` and `reviews.status` are
separate columns changed by separate operations, and after a restriction *and*
a suspension the account's review is still published with its full text. All
four combinations are reachable and ordinary:

```
active + removed review        one bad review, nothing more
active + a warning recorded
suspended + published reviews  the reviews were fine; the conduct was not
banned + published reviews     the same, permanently
```

Row 7 is symmetry that is easy to miss: somebody who could not *apply* a
sanction cannot *undo* one either. A moderator who could lift a suspension they
were not allowed to impose has the same power by another route.

Row 8 is why the standing is derived rather than stored blindly. Lifting the
strongest sanction returns the account to the next one still running, not
straight to active.

Row 10 gives the person on the receiving end the category, the written reason
and the dates — and not who applied it. Naming the individual moderator to
somebody they just sanctioned is how moderators get harassed, and the
accountability that matters here is Livd's rather than any one person's.

A `pg_cron` job returns accounts to their correct standing when a timed
sanction ends, because nothing in a request path would notice that it had.

## 2026-09-10 · Phase 9 · authority requests and disclosure records

Migrations under test: `0033_authority_requests`, `0034_fix_authority_decision_parameter`.

| # | Attack / behaviour | Result |
|---|---|---|
| 1 | Moderator records a request | BLOCKED — `requires Trust and Safety authorisation` |
| 2 | Moderator reads `authority_requests` | 0 rows |
| 3 | Trust & Safety records one | `AR-1004 / received` |
| 4 | Disclosure against an unapproved request | BLOCKED — `That request has not been approved` |
| 5 | Concluding with no written decision | BLOCKED — `Write the decision before concluding a request` |
| 6 | Disclosure naming no fields | BLOCKED — `Name exactly what was disclosed` |
| 7 | After a disclosure, the request | `fulfilled`, fields `account_created_at`, 3 audit rows |
| 8 | Does the disclosure audit entry contain an `@`? | 0 |
| 9 | Service role deletes a disclosure record | BLOCKED — grant revoked |
| 10 | **Table owner** rewrites a disclosure | BLOCKED — `disclosure_records is append-only` |
| 11 | **The subject of the request** reads either table | 0 rows, 0 rows |

### The most important property is an absence

Nothing in this area gathers or transmits a user's information. There is no
repository method, no administrative-layer function and no database function
that takes an authority request and produces an account's data.

`tests/safety/authority-requests.test.ts` asserts that directly — it checks the
repository for `exportUserData`, `gatherUserData`, `fulfilAuthorityRequest`,
`sendDisclosure` and four other plausible names, and scans the admin layer's
exports for anything matching `export|transmit|send.*data|gather`.

That test exists because this is precisely the thing somebody adds later in
good faith. "Wouldn't it be easier if approving just exported the fields?" — and
a button that assembles and sends an account's data on request is a button that
will eventually be pressed for a request nobody read properly. The judgement
stays with a person; what the software keeps is the memory of it.

Row 8 matters for the same reason as its equivalents in Phases 4 and 6: the
audit entry names the fields disclosed and never their values.

### A parameter that shadowed its column

`livd_decide_authority_request` took a parameter named `documentation_received`,
which is also a column on the table it updates. The unqualified reference inside
the UPDATE was ambiguous — and Postgres resolves that at *call* time, not at
creation, so the function was created without complaint and failed the first
time anybody passed that argument.

Fixed in `0034` by renaming it. Recorded because it looks completely fine in
review and only a test that actually exercises the argument finds it.

## 2026-09-11 · Phase 10 · the audit trail

Migrations under test: `0035_moderation_trail`, `0036_audit_feed`.

### The gap this phase closed was not in the new code

Phase 2 built `admin_audit_log` and the administrative layer that writes to it,
and every operation added since has gone through them. The four *oldest*
moderation paths never did. They still ran the way they always had:

```ts
const { error } = await admin.from('reviews').update({ status })...
if (error) throw ...

await admin.from('moderation_actions').insert({ ... });   // unchecked
```

The record's error is never examined. If that insert failed — a constraint, a
dropped connection, a policy nobody thought about — the review was removed and
nothing anywhere said who removed it or why, and the operation reported
success. Two statements rather than one meant a process dying in between
produced the same result on a good day.

A record written on a best-effort basis is not a record. It is a record most of
the time, which is indistinguishable from a record right up to the moment
somebody needs it.

All four are now database functions that do the change and write the entry in
one statement block, with the actor read from `auth.uid()` rather than accepted
as an argument.

### The trail

| # | Attack / behaviour | Result |
|---|---|---|
| 1 | Resident reads `livd_admin_audit_feed` | BLOCKED — `Not authorised to read the audit trail` |
| 2 | Resident reads `livd_admin_audit_summary` | BLOCKED — same |
| 3 | Resident calls `livd_set_review_status` | BLOCKED — `Only a moderator may change a review status` |
| 4 | Moderator, with a blank reason | BLOCKED — `A reason is required, for the audit trail` |
| 5 | Moderator does all four decisions | 4 rows in `moderation_actions`, one per decision |
| 6 | **Moderator reads the trail they just wrote to** | BLOCKED — `Not authorised to read the audit trail` |
| 7 | Approving a second claim on one property | BLOCKED — `Another claim on this property is already approved` |
| 8 | Re-deciding a decided claim | BLOCKED — `That claim has already been decided` |
| 9 | Trust & Safety reads the feed | 4 moderation rows + 5 audit rows, unified |
| 10 | Actor identity in the feed | `res***@demo.livd.invalid`, `the***@gmail.com` — masks only |
| 11 | Entries recording the read | exactly one per call, three calls, three entries |
| 12 | Moderation rows normalised | `property_claim_decided`, `report_resolved`, `review_status_changed`, `review_verification_changed` |
| 13 | Role stamped on a decision | `moderator` — the role held at the time |
| 14 | Read entries hidden by default / shown on request | 0 / 5 |

Row 6 is the one worth pausing on. A moderator is one of the people the trail
exists to hold accountable, so they cannot read it — but they are not shut out
of their own work: the case timeline shows them the history they are entitled
to see, attached to the case they did it under.

Row 10 points the opposite way to every other mask in this schema. Everywhere
else masking protects a resident from being identified; here it identifies an
*administrator* to Trust & Safety, because a trail whose actor column reads
`a4f3b2c1` is a trail nobody uses. It is still applied in SQL, so no raw
address enters the application to produce it.

### Reading the trail is recorded, in the same transaction as the read

`livd_admin_audit_feed` writes its `audit_log_read` entry inside the statement
block that answers the query. The pattern is Phase 4's: there is no ordering of
events in which somebody pages through the trail and nothing notes it.

This is the one place in Livd that lists, in order, every account whose
identity has been looked at. A log that exempts its own readers has a hole
exactly where the most curious person would look.

The consequence is noise, and the answer to it is a filter rather than a
secret: the page hides those entries by default, shows the count it is hiding,
and offers a checkbox. Row 14 checks both halves.

The two summary functions deliberately do **not** record a read. They run on the
same page load as the feed, which does, and three entries for one visit would
say something false about how many times the trail was opened.

### The same parameter-shadowing bug, twice

`livd_resolve_report` took a parameter named `resolution`, which is also the
column the UPDATE writes to. Inside an UPDATE the target table's columns are in
scope, so the reference was ambiguous — and Postgres resolves that at *call*
time, not at creation. The function was created without complaint and failed
the first time it was used.

This is the second occurrence: `documentation_received` in 0033 was the first.
Two is a pattern, so it now has a detector.
`tests/safety/audit-coverage.test.ts` extracts every function's parameters from
every migration, extracts the columns each one assigns in an UPDATE, and fails
on any overlap. An INSERT's VALUES list is deliberately not checked, because
table columns are not in scope there — which is why
`livd_open_authority_request` may take a `documentation_received` argument
quite safely.

**The detector was written, passed immediately, and was wrong.** The `\b` word
boundaries in its regex had been mangled into literal backspace characters by
the shell path used to write the file, so the pattern could never match
anything. It reported a clean corpus because it reported nothing at all.

What caught it was a second test that runs the same extraction over a function
carrying the bug on purpose and requires it to be found. That test is the
reason the detector is worth having: a detector nobody has watched fail is a
detector nobody knows works, and this one had already produced one silent
green tick.

### Vocabulary that claimed more than the system did

`AdminAuditAction` listed five actions nothing emitted: `data_exported`,
`security_config_changed`, `review_snapshot_taken`, `case_closed` and
`location_checks_reviewed`.

That is worse than a missing entry. A gap looks like a gap; a name in a list
looks like a guarantee. `data_exported` was the most misleading of the five —
Phase 9's defining property is that nothing in Livd gathers or transmits an
account's data, and a vocabulary entry for exporting quietly contradicted it.

All five are gone, and the coverage test now requires every remaining name to
be produced by the administrative layer, by a migration, or by the normaliser —
and, in the other direction, requires every action a migration writes to be one
the vocabulary knows.
