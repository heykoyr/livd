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

Four, and no more. Every one of them has a reason to exist and a destination.

| Address | Used for | Receives mail? |
| --- | --- | --- |
| `notifications@livd.site` | `From` on every notification Livd sends | No — send-only |
| `support@livd.site` | `Reply-To` on every notification; the address the product tells people to write to | **Yes** — must forward to a person |
| `hello@livd.site` | General and press contact, shown on the site | **Yes** — must forward to a person |
| `trust@livd.site` | Trust & Safety and authority contact | **Yes** — must forward to a person |

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

`support@`, `hello@` and `trust@` are aliases on Namecheap's free email
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

When a domain is added to Resend, the records it asks for are:

| Type | Host | Purpose |
| --- | --- | --- |
| MX | `send.livd.site` | Return-Path / bounce handling |
| TXT | `send.livd.site` | `v=spf1 include:amazonses.com ~all` |
| TXT | `resend._domainkey.livd.site` | DKIM public key |

**SPF is published on `send.livd.site`, not on the apex.** SPF authenticates
the envelope sender (the Return-Path), and Resend puts that on the subdomain.
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

Start at **`p=none`**:

| Type | Host | Value |
| --- | --- | --- |
| TXT | `_dmarc.livd.site` | `v=DMARC1; p=none; rua=mailto:trust@livd.site; fo=1; adkim=r; aspf=r` |

`p=none` is monitoring, not enforcement. It asks receivers to report what they
saw and to act on nothing.

That is the right starting policy here and not timidity, because this domain
has **two** independent mail streams — Resend and Namecheap's forwarder — and a
forwarder is precisely the thing DMARC breaks first. Forwarding rewrites
envelope senders and can invalidate a signature, so a `p=reject` published
before anyone has looked at a report is a policy that silently destroys
legitimate mail nobody was watching.

Relaxed alignment (`adkim=r`, `aspf=r`) for the same reason: the envelope
domain is `send.livd.site` while the From domain is `livd.site`, which is an
organisational match but not a strict one.

Tighten to `p=quarantine`, then `p=reject`, once a few weeks of `rua` reports
show both streams authenticating. Record the date here when it moves.

**Status: `p=none`, pending. Not yet published** — see the manual actions in
[`domain.md`](domain.md).

---

## 4. The API key

`RESEND_API_KEY` is server-only. It is read in exactly one place,
`src/server/notify/transport.ts`, which begins with `import 'server-only'` — a
build error rather than a runtime leak if it is ever pulled into a client
bundle. It is never prefixed `NEXT_PUBLIC_`.

It belongs in **Vercel → Production** only. Sending permission is sufficient;
the key needs no domain or account access.

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

The catalogue is a closed union in `src/server/notify/messages.ts`: twelve
messages, each with its subject, body, call to action and the preference that
governs it. Nothing sends mail except through it, so "what does Livd email
people" is answerable by reading one file.

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

Reports SPF, DKIM, DMARC, whether the forwarder's MX records survived, and —
if `RESEND_API_KEY` is present locally — whether Resend considers the domain
verified. Receiving a test email is not evidence that authentication passes;
this is.
