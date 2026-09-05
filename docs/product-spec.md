# Livd — Product Specification

**Version 0.1 · MVP scope**

---

## 1. What Livd is

Livd is a **global property intelligence platform built on real resident experiences**.

It answers one question that people everywhere ask before spending a large amount
of money on somewhere to live:

> **What is it really like to live here?**

A prospective renter can see the property, meet the landlord, look at photographs
and walk the neighbourhood. What they cannot easily discover is what the previous
residents actually experienced — the things that only reveal themselves after
three months of living there.

Livd closes that gap.

### What Livd is not

| Not this | Because |
| --- | --- |
| A listings marketplace | Livd never brokers a rental. No inventory, no commissions, no incentive to flatter a property. |
| A landlord directory | Reviews are about **properties and the experience of living in them**, not about individuals. |
| "Yelp for apartments" | A five-star average is not intelligence. Livd produces *structured* answers to specific questions. |
| A social network | There is no feed, no follower graph, no engagement loop. Contribution serves the next renter, not status. |
| A regional product | Livd is architected for the US, UK, Nigeria, Canada, Australia and Europe from the first commit. |

---

## 2. Positioning

Livd builds **a durable historical record of what it is like to live in a place**.

An individual review is useful. A property's *accumulated history* — across
residents, tenancies, managers and years — is defensible. That history is the
long-term asset and the reason the product gets more valuable with every
contribution.

**Brand voice:** calm, plain, exact. Editorial rather than promotional. Livd
states what the data supports and says clearly when it does not know something.
It never sells enthusiasm.

**Brand line:** *Know what it's really like to live there.*

Alternatives explored and rejected: "Before you rent, see how it was lived"
(grammatically strained), "The resident's record" (opaque to a first-time
visitor), "Rent with the full picture" (generic — could be any insurance
company). The chosen line is plain, universal, translates cleanly, and states the
product benefit in the user's own words.

---

## 3. Users

### Prospective renter — primary
Searching for somewhere to live, trying to avoid an expensive mistake. Arrives
via search with a specific address or area in mind. Wants a verdict fast, then
evidence. May be relocating internationally, in which case they have no local
network to ask.

**Success:** leaves knowing three concrete things to investigate before paying.

### Current resident
Lives somewhere now. Motivated by wanting the record to be accurate, or by
frustration that needs somewhere legitimate to go.

**Success:** contributes a structured review in under four minutes.

### Former resident — the highest-value contributor
Has moved out and knows *why*. This is the information no listing ever contains
and the single most differentiated dataset Livd holds.

**Success:** the "why I left" answer is captured as structured data, not just prose.

### Property owner / manager
May claim a property, correct factual details and respond publicly.

**Hard constraint:** an owner can **never** remove, edit, suppress or reorder a
legitimate review. Claiming a property grants a right of reply, nothing more.
This is stated in the product UI, not buried in terms.

---

## 4. Core journey

```
Discover → Search → Property profile → Resident verdict → Evidence
   → Why people leave → What to check before paying → Save / shortlist
   → (later, after moving) Contribute
```

The loop closes because every renter eventually becomes a former resident. The
contribution prompt is placed where it is emotionally true — at move-out — not
where it is convenient for growth metrics.

---

## 5. The intelligence layer

This is the product. Everything else is packaging.

### 5.1 Livd Score (0–100)

Not a star average. Deliberately a 100-point scale so it does not read as a
consumer-review star rating.

Composed of four adjustments applied to raw category ratings:

1. **Weighted category aggregate.** Categories carry different weights. Building
   condition and management matter more than parking.
2. **Recency decay.** A review from 2019 describes a property that may no longer
   exist in the same form. Half-life of 30 months, floored at 25% weight so
   history never vanishes entirely.
3. **Verification weight.** A verified resident's review carries roughly twice
   the weight of an unverified one.
4. **Bayesian shrinkage.** With few reviews the score is pulled toward a neutral
   prior. Three glowing reviews do not produce a 98.

Every score is displayed with a **confidence level** — `Insufficient`, `Limited`,
`Moderate` or `Strong` — derived from effective sample size. Below `Limited`, no
score is shown at all; the property page says what it does not know.

> **Rule:** Livd never displays a number it cannot substantiate. An empty state
> that admits ignorance is more trustworthy than a fabricated average.

### 5.2 Category scores

A core set applies globally. An extended set surfaces only where residents
actually rated it, so a London flat is not scored on generator reliability and a
Lagos apartment is not scored on central heating.

**Core (global):** building & maintenance · management & landlord ·
value for money · safety & security · noise · neighbours & community ·
location & transport · utilities & services

**Extended (surfaced on evidence):** water supply · power reliability ·
heating & cooling · internet · cleanliness & waste · parking · accessibility ·
drainage & flooding · pests · natural light

Category definitions live in a reference table, not in code branches, so new
markets are configuration rather than a release.

### 5.3 Why residents leave

The signature section. Aggregates the structured departure reason from every
former resident who gave one, shown as a ranked distribution with counts.

Suppressed entirely below **four** former-resident responses, with an honest
explanation rather than a misleading 100% bar built on one person.

### 5.4 Resident verdict

A short summary of what residents collectively say.

**Generated deterministically from structured data** — category outliers,
recurring departure reasons, recommendation rate, trend direction. It is
assembled from real aggregates by a rules engine, so it cannot hallucinate. The
implementation sits behind an interface (`VerdictGenerator`) so a language model
can be substituted later without touching the property page, and any future model
output must be grounded in the same aggregates.

### 5.5 Trend and timeline

Year-bucketed scores produce a direction — improving, stable or declining — only
when at least two buckets each hold enough reviews. Timeline entries are derived
strictly from data residents reported (management change, rent increase, a
category's score moving materially). Nothing on the timeline is invented.

### 5.6 What to check before you visit

Derived from the property's weakest categories and most-cited problems, expressed
as questions the renter can literally ask. This converts intelligence into action
and is, for many users, the most useful thing on the page.

---

## 6. Review system

### Flow — nine short steps, one decision per screen

1. Which property?
2. Are you a current or former resident?
3. When did you live there? *(month precision; never exact dates)*
4. Overall experience
5. Rate the categories that mattered *(core always; extended opt-in)*
6. What was good?
7. What was difficult?
8. **Why did you leave?** *(former residents only — progressive disclosure)*
9. In your own words *(optional, guided by prompts)*

Rationale for the split: a single long form produces abandonment and low-quality
prose. One question per screen produces structured, comparable data — which is
what the intelligence layer needs.

### Captured

Residency status · tenure · move-in/out month · overall rating · category ratings
· departure reason (primary + secondary) · positive tags · problem tags ·
recommendation · optional prose · optional rent range and currency.

### Deliberately not captured

Exact address including unit · full name · phone · employer · household
composition · exact dates · anything identifying a neighbour or a named
individual.

---

## 7. Anonymity and privacy

Public review attribution is limited to:

> **Verified former resident** · lived here 2 years · left 2024

No names. No handles. No profile links from a review. Unit numbers are stored
privately where needed for verification and are **never** exposed by a public
query — enforced in the database's column grants, not only in the UI.

Verification evidence is written to a table that no client-facing role can read
under any circumstance.

---

## 8. Verification

Three levels, designed to grow:

| Level | Meaning |
| --- | --- |
| `unverified` | Account exists. Review counts, weighted lower, labelled plainly. |
| `verified_resident` | Residency evidenced (tenancy document, utility bill, geo-confirmed stay, or operator review). |
| `disputed` | An open claim against the review's authenticity. Weight drops to zero pending resolution; the review remains visible and labelled. |

Verification is deliberately not required to contribute. Requiring documents up
front would collapse supply, and an unverified review that is clearly labelled is
more honest than no review at all.

---

## 9. Trust and safety

Livd is a review platform about places people live. The failure modes are
predictable and are designed against from the start.

**Content rules — enforced server-side before a review is stored:**

- No contact details of any kind (phone, email, URL, messaging handle).
- No named individuals. The subject is the property, not a person.
- No unsupported criminal allegations stated as fact.
- No threats, harassment or discriminatory content.
- No unit numbers or other information that identifies a specific household.

Violations are either **blocked** (the user is told exactly what to change) or
**flagged for moderation** (published-pending-review or held, depending on
severity). Both paths are implemented, not stubbed.

**Manipulation defences:**

- One published review per person per property per tenancy.
- Rate limits on submission, reporting and account creation.
- Owner-account submissions to owned properties rejected outright.
- Burst detection: an unusual concentration of new accounts reviewing one
  property flags the property for review.
- Reported reviews enter a moderation queue with a full audit trail.

**Owner rights:** claim, correct factual data, respond publicly once per review,
mark an issue resolved, dispute authenticity. **Not** delete.

See `docs/architecture.md` §7 for the implementation of each control.

---

## 10. MVP scope

**In:**

Landing · search with suggestions and typo tolerance · property profile with full
intelligence layer · nine-step review flow · content safety pipeline · report and
moderation queue · admin area · authentication · saved properties and side-by-side
comparison · property claims and owner responses · SEO-ready server-rendered
property and location pages · seeded multi-market demo data.

**Explicitly out of v1:**

Maps (privacy design work needed first — a pin on a residential building is a
liability before it is a feature) · messaging between users · notifications
beyond in-app · mobile apps · payments · any AI-generated prose · rental price
history as a headline feature.

---

## 11. Metrics

Search → property view · property view → review start · review start →
completion · verification rate · reports per thousand reviews · shortlist
creation · returning contributors.

Collected as counted events with no cross-site identifiers, no third-party
analytics and no personal data in event payloads.

---

## 12. Business model — deferred

The MVP optimises for **trust, data and usefulness**. Nothing in the product is
gated, upsold or advertised against.

Plausible later: property intelligence reports, relocation research tools,
verified property profiles for managers, market data. Each is evaluated against
one test — *does this create an incentive to distort what residents said?* If
yes, it is not built.
