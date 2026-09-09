# Legal review — briefing pack

**Status: not started. This document exists so that it can be.**

`docs/roadmap.md` lists "legal review of the three policy pages in each launch
market" as a pre-launch item. That review has to be done by qualified counsel in
each jurisdiction, and nothing in this file is legal advice or an assertion that
Livd complies with anything.

What this file *is*: the brief. A description of what the system actually does
with personal data, cross-referenced to the code that does it, so a lawyer is
not reverse-engineering a product before they can start; a list of the claims
the three published pages make, so each can be checked against the behaviour;
and the questions that are specific enough to this product that generic
templates will not answer them.

Written September 2026, against commit-current behaviour. Anything below that
says "verified" means it was read in the code, not that it was tested by a
lawyer.

---

## 1. What is published today

| Page | Route | Source |
| --- | --- | --- |
| Privacy | `/legal/privacy` | `src/app/legal/privacy/page.tsx` |
| Terms | `/legal/terms` | `src/app/legal/terms/page.tsx` |
| Content policy | `/legal/content-policy` | `src/app/legal/content-policy/page.tsx` |

All three end by saying they are a plain-English description of the build,
not legal advice, and that counsel will review them. Keep that sentence until
the review has actually happened.

---

## 2. What the system does with personal data

Everything here is checkable in the schema (`supabase/migrations/`) and the
adapters (`src/server/data/`).

### Collected

| Data | Where | Notes |
| --- | --- | --- |
| Email address | `auth.users` | The only identifier. Used to sign in and to enforce one review per person per tenancy. |
| Country (optional) | `profiles.country_code` | Chooses address, date and currency formatting. |
| Preferred locale | `profiles.preferred_locale` | |
| Review content | `reviews` and its child tables | Written by the account holder, published with no link back to them. |
| Saved properties | `saved_properties` | Never public. |
| Reports made | `review_reports.reporter_id` | The reported author is never told who reported them. |
| Verification evidence | private storage bucket, `verification_records` | See §4. |
| Rate-limit events | `rate_limit_events` | Salted digest of the actor, never an IP. Pruned nightly at two days. |
| Search events | `search_events` | Salted hash of the query, the locality, a result count. No actor column of any kind. |

### Deliberately not collected

There is **no name, phone number or postal address field on an account** — not
nullable, absent from the table. No password is ever stored, because
authentication is a one-time email code (`signInWithOtp`). No third-party
analytics, advertising or tracking is loaded; the Content-Security-Policy in
`next.config.ts` permits `'self'` and the Supabase origin and nothing else, and
fonts are self-hosted by `next/font` so rendering a page contacts no one.

### Precision to check with counsel

- **"Livd never stores a password."** True of the application. Supabase's
  `auth.users` table nonetheless *has* an `encrypted_password` column, which is
  empty. Whether the sentence is accurate enough as written is a judgement.
- **Deliberate minimisation reads as a promise.** Several sentences describe a
  design decision ("a field that does not exist cannot be leaked"). Confirm this
  is not construed as a contractual warranty.

---

## 3. Required disclosures that are absent

These are structural absences — checkable by reading the page — rather than
conclusions about compliance. Every launch market's regime expects most of them
in some form.

- **Who the controller is.** No legal entity name, registered address or
  registration number appears anywhere on the site.
- **A contact route.** Terms say decisions "can be appealed by contacting us".
  There is no contact address, form or email anywhere in the product.
- **A data protection contact or representative**, and whether an Article 27
  representative is needed for any market where there is no establishment.
- **Legal basis for each purpose.** Nothing states why each category is
  processed (contract, legitimate interests, consent) or records a legitimate
  interests assessment — the balancing test for publishing residents' accounts
  of named buildings is the substantive one and it is not written down anywhere.
- **Retention periods.** Only `rate_limit_events` has one (two days, in
  migration 0009). Reviews are explicitly permanent; `search_events`,
  `moderation_actions`, `verification_records` and the evidence bucket have no
  stated period.
- **Data subject rights and how to exercise them.** Access, rectification,
  erasure, portability, objection and the right to complain to a supervisory
  authority are not mentioned. There is no DSAR process, and no route in the
  product for making one.
- **International transfers.** Data is in Supabase `eu-west-2` and served
  through Vercel. Neither is named on the privacy page, no sub-processors are
  listed, and no transfer mechanism is stated. This matters most for Nigerian
  and Australian residents whose data sits in the UK.
- **Automated decision-making.** The Livd Score, the burst detector
  (`livd_detect_property_flags`) and the content linter all process personal
  data automatically. None produces a legal effect without a human, and the
  detector explicitly only flags — but the position should be recorded rather
  than inferred.
- **Cookies.** A session cookie is set on sign-in. There is no cookie notice.
  Confirm whether a strictly-necessary session cookie needs one in each market.
- **Age.** Terms say "old enough to enter a tenancy agreement where you live",
  which varies. Confirm whether a stated minimum age is required, and whether
  any market needs age assurance.

---

## 4. The three questions specific to this product

Generic templates will not answer these, and they are the ones that could
change what gets built.

### 4.1 Permanent reviews against the right to erasure

**RESOLVED in migrations 0017 and 0018.** `author_id` is now nullable with
`on delete set null`, account deletion is implemented at `/account`, and the
outcome is tested against both adapters. The record below is kept because the
reasoning still stands and because the second half — whether unlinking is
sufficient anonymisation at all — remains a question for counsel.

**This one was not just unreviewed. The schema did the opposite of
what the pages promise.**

All three pages state that deleting an account removes the account and that
published reviews remain, permanently unlinked from their author. The reasoning
given is that the property record is what other renters rely on, and a record
that can be withdrawn later is not a record.

What the schema actually says:

```sql
author_id uuid not null references profiles(id) on delete cascade
```

Deleting a profile **deletes that person's reviews**. Not unlinks — deletes,
along with their category ratings, departure reasons and tags, by cascade. The
property record the pages describe as permanent would lose exactly the parts a
departing user contributed.

Two further facts complete the picture:

- Account deletion **is not implemented**. `/account` says it is "handled by
  support while Livd is in early access — email us", and there is no email
  address anywhere in the product (see §3). So the promise is currently
  unfulfillable rather than wrong in practice.
- `reviews` has no delete *grant* for any role, so nothing can delete a review
  through the API. The cascade is a database-level path that opens the moment
  anything deletes a profile — which is precisely what account deletion will do.

**To settle, in this order:**

1. Whether "permanently unlinked" is sufficient anonymisation at all, or whether
   a review remains its author's personal data because the link was severed
   rather than never made. This determines the fix.
2. If unlinking is sufficient: `author_id` becomes nullable with
   `on delete set null`, and the RLS policies that compare
   `author_id = auth.uid()` need re-reading, as does the
   `reviews_one_per_tenancy` index. Straightforward, but it is a schema change
   and it is not written yet.
3. If it is not sufficient: the pages change instead, and the product accepts
   that reviews disappear when accounts do.

**Do not launch either the current wording or the current schema.** They
contradict each other, and whichever way that is resolved, one of them moves.

The same `on delete cascade` sits on `owner_responses.responder_id`,
`review_reports.reporter_id`, `property_claims.claimant_id` and
`verification_records.submitted_by`. For reports and verification evidence,
deletion on account closure is probably right. For an owner's public reply to a
review, it raises the same question as the review itself.

### 4.2 Anonymous authorship against defamation

Reviewers are anonymous by design: no name, no handle, no profile. Owners may
reply but can never edit, hide or remove a review — again structural, with no
column and no policy that would permit it.

**To settle:** the notice-and-takedown obligations in each market, the operator
protections that depend on being able to identify an author (in England and
Wales, the Defamation Act 2013 s.5 process turns on exactly this), what Livd
must do on receiving a complaint, and whether the current moderation flow —
report, human decision, audit log, no automatic removal — meets it. Also
whether holding serious allegations for human review before publication, which
the content linter does, helps or hurts the position.

### 4.3 Owner right of reply against rectification

An owner can claim a property, correct factual details and reply publicly. They
cannot alter a review.

**To settle:** whether an owner who says a review is factually wrong has a
rectification right that a right of reply does not satisfy, and what happens
when the disputed fact is the reviewer's own experience rather than a property
attribute.

---

## 5. Per-market notes

Launch markets, from `src/config/markets.ts`.

| Market | Regime | The distinctive thing |
| --- | --- | --- |
| United Kingdom | UK GDPR, DPA 2018, Defamation Act 2013 | s.5 operator defence turns on identifying the author, which Livd deliberately cannot do. ICO registration likely required. |
| Ireland, Germany, Netherlands | GDPR | Lead supervisory authority depends on establishment. Germany: check whether the Telemediengesetz successor rules on user-generated content bear on this. |
| United States | State law, not federal | California CCPA/CPRA thresholds; Section 230 shapes the intermediary position quite differently from the UK. |
| Canada | PIPEDA, Quebec Law 25 | Law 25 has its own consent and transfer requirements. |
| Australia | Privacy Act 1988, APPs | APP 8 governs the cross-border disclosure to UK-hosted infrastructure. |
| Nigeria | NDPA 2023, NDPC | Registration as a data controller of major importance may apply; the cross-border transfer basis to `eu-west-2` needs stating. |

---

## 6. Claims to verify against the build

Each of these appears on a published page. Each is true of the code as read
today; each should be confirmed by whoever signs the page off, because a
privacy page is a statement of fact and these are the falsifiable ones.

| Claim | Where it is true |
| --- | --- |
| No name, phone or address field on an account | `profiles`, migration 0001 |
| No password stored | `signInWithOtp` in `src/server/actions/auth.ts` |
| Dates stored to the month, never the day | `reviews_month_pinned` constraint, migration 0002 |
| Unit numbers refused at submission | `src/lib/safety/content-linter.ts` |
| Saved properties never visible to anyone else | RLS policy, migration 0004 |
| Reporter identity never disclosed to the author | No route reads `reporter_id` into a public view |
| Verification evidence unreadable by any account | Bucket has no policy for any client role, migration 0012 |
| Owners cannot remove reviews | No delete grant on `reviews` anywhere in the schema |
| Moderation log cannot be edited or deleted by anyone | `moderation_actions`, no update or delete policy |
| No third-party analytics or tracking | CSP in `next.config.ts`; no analytics package in `package.json` |
| Search stores no identifier | `search_events` has no actor column |

---

## 7. Before this can be signed off

1. Incorporate a legal entity and put its details on the site.
2. Give the product a contact route. Several policy promises currently point at
   one that does not exist.
3. Answer §4.1 first, and fix the contradiction it describes. The published
   pages and the database currently disagree about what happens to a review
   when its author leaves, and account deletion is not built at all.
4. Have counsel in each market review the three pages against §2 and §3.
5. Record a legitimate interests assessment for publishing residents' accounts.
6. Name the sub-processors: Supabase, Vercel, and whichever email provider is
   chosen for magic links.
7. Re-run this brief. It describes a moving product and will go stale.
