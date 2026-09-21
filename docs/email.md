# Livd — email

Two separate paths send mail as Livd, and conflating them is the most common
way a product ends up with a beautifully branded notification and a sign-in
email that says "Supabase Auth".

| | Sent by | Configured in | Template lives in |
| --- | --- | --- | --- |
| **Notifications** — review published, owner responded, claim decided, staff escalations | Livd's own code, through Resend's HTTP API | `RESEND_API_KEY` + `LIVD_EMAIL_FROM` | `src/server/notify/` |
| **Authentication** — the sign-in link | Supabase Auth (GoTrue) | Supabase dashboard, custom SMTP | `supabase/templates/magic-link.html` |

Adding Resend to the application changes the first and **nothing at all** about
the second. The magic-link email is sent by Supabase's own infrastructure and
is branded by Supabase until custom SMTP is configured in its dashboard. See
[`../supabase/templates/README.md`](../supabase/templates/README.md).

---

## 1. Addresses

Five, and no more. Every one of them has a reason to exist and a destination.

| Address | Used for | Receives mail? |
| --- | --- | --- |
| `notifications@livd.site` | `From` on every notification Livd sends | No — send-only |
| `support@livd.site` | `Reply-To` on every notification; the address the product tells people to write to | **Yes** — must forward to a person |
| `hello@livd.site` | General and press contact, shown on the site | **Yes** — must forward to a person |
| `trust@livd.site` | Trust & Safety and authority contact | **Yes** — must forward to a person |
| `dmarc@livd.site` | Where receivers send DMARC aggregate reports | **Yes** — forward, and filter |

Deliberately absent: a `no-reply@`. Two messages in the catalogue — a removed
review and a rejected claim — say *"reply to this email and a person will look
at it again"*. That is a promise made to somebody who has just had their
writing taken down, and `no-reply` would break it. `Reply-To: support@livd.site`
is how it is kept.

`notifications@` is the `From` and not `support@` because the two do different
jobs: `From` is an identity a mail client groups and files by, and mixing
machine-sent notifications into the thread of a human support conversation
makes both harder to read.

### The mailboxes are Namecheap email forwarding

`support@`, `hello@`, `trust@` and `dmarc@` are aliases on Namecheap's free email
forwarding, which is already live — the five `eforward*.registrar-servers.com`
MX records on the apex predate this migration. They forward to the founder's
real inbox. There is no mailbox to log into and no IMAP.

This is why [`domain.md`](domain.md) is so insistent that the MX records
survive the DNS change. Deleting them does not produce an error anywhere; it
produces a `Reply-To` address that bounces, on emails that invite a reply.

---

## 2. Why the sending domain is the apex, and why that does not collide

Resend sends as `livd.site` — the apex — not a `send.livd.site` sending
subdomain, and this is the opposite of what Resend's own reputation-isolation
advice suggests at first reading. The reason is that Resend already does the
isolation itself, in the right place.

What is published for Resend, read from the live zone on 17 September 2026 —
the values Resend's dashboard issued for this domain, not a template of what
Resend usually asks for:

| Type | Host | Value | Purpose |
| --- | --- | --- | --- |
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQ…` (216-char key) | DKIM public key |
| CNAME | `rsend` | `rsend-euw1.forge.rmta.net` | Return-Path **in use**: carries MX `feedback-smtp.eu-west-1.amazonses.com` and `v=spf1 include:amazonses.com ~all` |
| CNAME | `send` | `send.forge.rmta.net` | A second return-path Resend issued: MX `feedback.forge.rmta.net` and its SPF |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@livd.site;` | DMARC — see §3 |

**`rsend` is the one real mail uses, and it is the one that looks like a
duplicate.** A sign-in email sent through Resend on 17 September 2026 carried
`Return-Path: …@rsend.livd.site` and passed SPF there. Deleting `rsend` as
untidy would fail SPF on every message while `send` went on resolving
perfectly, so `npm run domain:check` treats a missing `rsend` as blocking.

**An earlier version of this table was wrong, and it is worth saying how.** It
listed an MX and a TXT on `send` carrying `include:amazonses.com` — the shape
Resend was commonly documented as asking for, written down without asking the
provider. Resend issued a single CNAME instead, delegating the return-path to a
host it controls. The readiness check had the same assumption built in and
reported a correctly configured domain as unverified. Both now ask what is
actually published. Take values from resend.com/domains, never from here.

**SPF is published under `send.livd.site`, not on the apex.** SPF authenticates
the envelope sender (the Return-Path), and Resend puts that on the subdomain —
here by delegating the whole name to its own host with a CNAME.
So the apex SPF record that Namecheap's forwarding already owns —
`v=spf1 include:spf.efwd.registrar-servers.com ~all` — is never touched, never
merged, and never duplicated. The single most likely way to break this domain's
email is to "add Resend's SPF" to the apex, producing two SPF records on one
name, which receivers may treat as a permanent error and fail *every* message
including the forwarded ones.

**Do not add an SPF record to the apex. There is already one, and Resend does
not want another.**

DKIM meanwhile is published at `resend._domainkey.livd.site`, which is a
subdomain of the apex, so a message `From: notifications@livd.site` is
DKIM-signed by a key that is *aligned* with the From domain. That alignment is
what lets DMARC pass, and it is what makes the apex From address safe to use
despite the envelope living on `send.`.

The result is the best of both: `Livd <notifications@livd.site>` in the From
line, bounce and reputation traffic isolated on a subdomain, and zero conflict
with the mail the domain already handles.

---

## 3. DMARC

**Published** (updated 17 September 2026 — it previously had no `rua`):

| Type | Host | Value |
| --- | --- | --- |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@livd.site;` |

Edit the existing `_dmarc` record rather than adding a second — with two DMARC
records on one name, receivers ignore both.

`p=none` is monitoring, not enforcement. It asks receivers to act on nothing,
and that is the right starting policy: this domain has **two** independent mail
streams — Resend and Namecheap's forwarder — and forwarding is the first thing
DMARC breaks. A `p=reject` published before anybody has read a report is a
policy that silently destroys legitimate mail nobody was watching.

But `p=none` with no `rua` is monitoring that reports to nobody. The point of
starting at `none` is to gather the evidence that makes tightening safe, and
without `rua` there is never any — so the domain stays at `none` forever by
default rather than by decision. `npm run domain:check` flags exactly this.

**Why `dmarc@` and not `trust@`.** Aggregate reports are daily XML attachments
from every large receiver. `trust@` is where an authority request arrives, and
whoever reads that should not wade through zip files to find it. A dedicated
alias forwards to the same inbox and filters out of sight with one rule. Reports
to an address on the domain being reported need no extra authorisation record.

No `adkim`/`aspf` tags: relaxed alignment is the default, and relaxed is what
is needed — the envelope domain is `send.livd.site` while the From domain is
`livd.site`, an organisational match rather than a strict one. DKIM signs as
`livd.site` itself, so DKIM alignment is exact.

Tighten to `p=quarantine`, then `p=reject`, once a few weeks of reports show
both streams authenticating. Record the date here when it moves.

---

## 4. The API key

`RESEND_API_KEY` is server-only. It is read in exactly one place,
`src/server/notify/transport.ts`, which begins with `import 'server-only'` — a
build error rather than a runtime leak if it is ever pulled into a client
bundle. It is never prefixed `NEXT_PUBLIC_`.

It is in **Vercel → Production** only — added 17 September 2026, marked
sensitive, and live from deployment `f80022a` onwards. Sending permission is
sufficient; the key needs no domain or account access.

A sending-only key cannot list domains, so `npm run domain:check` run with one
reports that it cannot ask rather than that the domain is unverified. That is
the key being correctly scoped.

**It does not belong in Supabase.** Livd has no Edge Functions — `supabase/`
contains migrations and an email template and nothing else — so there is no
second runtime that needs the key. If an Edge Function is ever added that
sends mail, it needs its own copy in Supabase's secrets: Vercel's environment
variables are not visible to Supabase, and assuming otherwise is how a
function ends up silently unable to send.

---

## 5. Environments

Livd must not send real mail from a laptop, and must not mail real people from
a preview build.

**Without `RESEND_API_KEY`, nothing breaks.** The transport logs the subject
and the recipient's *domain* to the server console and reports success. Every
flow — review submission, moderation, claims — works end to end on a fresh
clone with nothing configured. This is deliberate: a missing key must never
turn "the confirmation email bounced" into "the review was not published".

| | `RESEND_API_KEY` | Behaviour |
| --- | --- | --- |
| Development | unset | Console transport. Nothing leaves the machine. |
| Preview | unset | Console transport. Preview builds cannot mail real users. |
| Production | set | Resend. |

Leaving the key out of Preview is the control, and it is a better one than a
recipient allow-list because it cannot be got wrong by a typo. If a preview
ever genuinely needs to send, set the key on that environment deliberately and
point `LIVD_EMAIL_FROM` at the same verified domain.

---

## 6. What is sent, and once

The catalogue is a closed union in `src/server/notify/messages.ts`: fourteen
messages, each with its subject, body, call to action and the preference that
governs it. Nothing sends mail except through it, so "what does Livd email
people" is answerable by reading one file.

Two sets in the same file decide what a switch cannot turn off:

- **`ALWAYS_SENT`** — `review_removed`, `review_restored`, `account_sanctioned`
  and `account_sanction_lifted`. The preferences page promises that a decision
  removing something a person wrote, or changing their account's standing,
  reaches them whatever is switched off. Until 17 September 2026 the dispatcher
  consulted the "Your reviews" switch for a removal anyway, and no email for a
  change of standing existed at all.
- **`SENT_TO_BANNED`** — the two standing messages, and nothing else. Since
  migration 0050 `livd_notification_recipient` returns a banned account, so a
  ban can be explained to the person banned; the dispatcher then refuses that
  account everything that is not about its own standing.

A standing message carries the sanction's category and its public description,
never the moderator's written reason — that field is a note for the next
colleague and may describe what a report said. A removal message *does* quote
the moderator's reason, and the removal form now says so.

The delivery check at `/admin/email` sends all fourteen. The production run on
17 September 2026 recorded below predates the two standing messages, which is
why it reads twelve.

**Idempotency is a database constraint, not a convention.** `notify()` claims a
unique `dedupe` key *before* rendering the message, so a retried Server Action,
two concurrent callers and five writes of the same status all resolve to one
send. Keys are shaped `<kind>:<subject id>` so the same real-world event
computes the same key wherever it is noticed — the submit action and a
moderator's restore both produce `review_published:<review id>`.

Staff fan-out claims one key per recipient (`<dedupe>:<user id>`) so one
person's bounce does not suppress everybody else's copy.

Changing the sending domain does not interact with any of this. The ledger is
keyed on the event, never on the address or the provider, so nothing about
this migration can produce a duplicate.

---

## 7. Checking it

```bash
npm run domain:check
```

Reports the apex SPF, the return-path, DKIM, DMARC, whether the forwarder's MX
records survived, and — given a key that can read domains — whether Resend
considers the domain verified.

Existence is judged against the zone's **own nameservers**, not a public
resolver. Some of Google Public DNS's anycast nodes went on answering NXDOMAIN
for `send.livd.site` after the record was published, and a check asked through
it flapped between pass and fail. What public resolvers still believe is
reported separately, as propagation.

Receiving a test email is not evidence that authentication passes, and DNS
being correct is not evidence that mail is sent. Both are needed — see §8.

---

## 8. The delivery check

**/admin/email**, administrators only.

Shows what the running deployment will send as — provider, From, Reply-To and
the origin links resolve against — then sends every message in the catalogue to
the signed-in administrator through the production renderer and transport.
Subjects gain a `[Test]` prefix; everything else is exactly what a real
notification carries. Results come back per message, with Resend's message id.

It exists because the alternative is posting reviews and owner responses on
the live site, which has no delete path, to make production send the emails
those events trigger.

It takes no recipient, so it cannot mail anybody but the person pressing it; it
runs three times an hour; it claims no notification dedupe key, so it can never
suppress a real send; and it is recorded in the audit trail as
`email_delivery_tested`, with the recipient's domain and never the address.

**What to check in what arrives.** Open the original message:

- `From: Livd <notifications@livd.site>` and `Reply-To: support@livd.site`
- `Authentication-Results`: `dkim=pass header.i=@livd.site`, `spf=pass`, and
  `dmarc=pass header.from=livd.site`
- every link, including the one behind the logo, on `https://livd.site`
- the logo at the top rendering as the official mark, not as alt text — it is
  loaded from `https://livd.site/brand/email/livd-logo.png`
- **no rectangle around the logo**, in a dark client as well as a light one.
  The file is transparent; a tile around it means the wrong asset shipped

The page cannot test sign-in email. Supabase sends that itself — see
[`supabase/templates/README.md`](../supabase/templates/README.md).

---

## 9. Status — 17 September 2026

| | State | Evidence |
| --- | --- | --- |
| DKIM | published | `resend._domainkey.livd.site`, 216-char key, read from the authoritative servers |
| Return-path | published, and passing | `rsend` → `rsend-euw1.forge.rmta.net` carries live mail; `send` also resolves |
| DMARC | published, reporting | `v=DMARC1; p=none; rua=mailto:dmarc@livd.site;` |
| Apex SPF | intact, single | the forwarder's record, untouched |
| `RESEND_API_KEY` | Vercel Production only | live from deployment `f80022a` |
| Notifications through Resend | **delivered and authenticated** | delivery check at 14:32 UTC, run by an administrator in production: audit entry `email_delivery_tested`, provider `resend`, `sent: 12, failed: 0`; one message opened in the receiving inbox showed `dmarc=pass` for `livd.site`. The notification ledger was untouched, as designed |
| Sign-in email | **Livd, authenticated** | a real link requested 17 September 14:26 UTC arrived in four seconds as `Livd <notifications@livd.site>`, subject `Your Livd sign-in link`, Livd's template; Gmail recorded `dkim=pass header.i=@livd.site header.s=resend`, `spf=pass` on `rsend.livd.site`, `dmarc=pass header.from=livd.site`; redirect to `https://livd.site/auth/callback` |
| Resend domain | verified in effect | Resend accepted and DKIM-signed a send as `@livd.site`, which it refuses for an unverified domain |
