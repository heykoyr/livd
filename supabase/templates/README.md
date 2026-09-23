# Auth email — what is set in Supabase, and why

Supabase owns four things Livd's sign-in depends on: the URL configuration, the
SMTP sender, the email templates and the rate limits. None of them live in this
repository. This file records what each one is set to, why, and how to check it
from outside — because a written-down value has been wrong here before, for
weeks, without anybody noticing.

Last read from the live project on **21 September 2026**, through the
Management API (`GET /v1/projects/tehkyjihyyhxxrqlvmck/config/auth`).

---

## 0. How email sign-in works

```
/sign-in                 person enters an address
  │  requestSignIn       signInWithOtp — Supabase stores a one-time token
  ▼
email                    Livd <notifications@livd.site>, via Resend SMTP
  │                      link:  https://livd.site/auth/confirm?token_hash=…&type=email&next=…
  │                      code:  the same token, as eight digits
  ▼
/auth/confirm            GET. Shows "Sign in to Livd". Spends nothing.
  │  tap                 POST, same-origin only
  ▼
/auth/verify             verifyOtp({ token_hash, type }) — Supabase checks and
  │                      deletes the token, returns a session; httpOnly cookies
  ▼
next                     the page the person was on, a Livd path only
```

Or, on the "check your email" screen, the eight-digit code →
`verifySignInCode` → `verifyOtp({ email, token })`. Same token: using either
spends both.

**Why it is built this way.** Until 21 September the email carried Supabase's
default `{{ .ConfirmationURL }}`. That link goes to Supabase, which spends the
token on the first GET and then redirects with a PKCE code, which Livd
exchanged for a session at `/auth/callback`. The exchange needs the PKCE
verifier — a cookie in the browser that asked for the email. Supabase's auth
log for 21 September shows what that means on an iPhone whose default browser
is Chrome:

```
01:29:06  POST /otp      from the Vercel function (the request, made in Safari)
01:29:37  GET  /verify   303, user agent CriOS — iOS Chrome
01:29:39  POST /token    400 "both auth code and code verifier should be non-empty"
```

The link opened in Chrome, Chrome had no verifier, and the page said "that
link did not work … sign-in links expire", which was not what happened.
Ten minutes later a second attempt failed with `bad_code_verifier` — Chrome now
held a verifier, from a different request — and tapping that link again gave
"One-time token not found". The request after that was refused with
`429: For security purposes, you can only request this after 10 seconds`, which
Livd described as a limit "on our email provider".

The token-hash design fixes all of it without weakening anything:

- **Any browser.** `verifyOtp` with a token hash needs nothing from the
  requesting browser. This is the flow Supabase documents for server-rendered
  apps.
- **Scanner-proof.** Opening the link does nothing; only the tap (a POST) does.
  Mail scanners — Gmail's, Outlook Safe Links, corporate gateways — fetch links
  but do not submit forms, so they cannot spend the token before its owner.
- **Still one-time, still expiring.** Supabase deletes the token when it is
  redeemed and refuses it after `mailer_otp_exp`. Livd never builds, stores or
  logs a token.
- **Cross-device.** The code covers the email that opens on a phone while the
  sign-in page waits on a laptop.

What is given up: PKCE bound the link to the browser that asked, so a link
intercepted in transit was useless elsewhere. A token-hash link is a bearer
credential for up to an hour — the same property every magic link without PKCE
has, and exactly the property that makes it work in the browser iOS opens.
Google sign-in keeps PKCE, where one tab does the whole round trip.

`/auth/callback` still exists for Google, and as a degraded fallback: if the
template were ever reverted to `{{ .ConfirmationURL }}`, the link would land
there and finish in the requesting browser — and say plainly when it could
not.

---

## 1. URL configuration

**Authentication → URL Configuration**

| Field | Live value | Why |
| --- | --- | --- |
| Site URL | `https://livd.site` | The host of every sign-in link (`{{ .SiteURL }}` in the template), and Supabase's fallback for any redirect it will not honour |
| Redirect URLs | `https://livd.site/**`, `https://www.livd.site/**`, `http://localhost:3000/**` | `/auth/callback` (Google, and the `emailRedirectTo` passed as `next`); localhost for development |

Nothing else is needed. `/auth/confirm` is not a redirect target — the email
links to it directly — so it needs no entry. Preview deployments are
deliberately absent: they are behind Vercel SSO and nobody signs into them.

**Supabase does not reject a redirect it will not honour; it substitutes the
Site URL, silently.** Probe it rather than trusting this table:

```bash
curl -sI -H "apikey: $ANON_KEY" \
  "$SUPABASE_URL/auth/v1/verify?token=probe&type=magiclink&redirect_to=https%3A%2F%2Fnot-allowed.example%2Fx" \
  | grep -i '^location'
```

`npm run domain:check` wraps this.

---

## 2. SMTP — Resend

**Authentication → Emails → SMTP Settings**

| Field | Live value |
| --- | --- |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | the Resend API key named **Supabase** (sending access only) |
| Sender email | `notifications@livd.site` |
| Sender name | `Livd` |

Configured 17 September 2026. The domain `livd.site` is verified in Resend
(region eu-west-1) with DKIM `resend._domainkey`, the `send`/`rsend` return
paths and DMARC — see [`docs/email.md`](../../docs/email.md). The Supabase key
is separate from the application's so either can be rotated alone.

**Link tracking is off, and must stay off.** Resend's click tracking rewrites
every link through a tracking host; a rewritten sign-in link is the classic way
these break. The domain's *Configuration → Enable tracking metrics* is not
configured, so nothing is rewritten.

---

## 3. The email itself

**Authentication → Emails → Magic Link** *and* **Confirm signup**

Both templates get the same file, [`magic-link.html`](./magic-link.html), and
the same subject, `Your Livd sign-in link`. A first sign-in is sent the
*Confirm signup* template, not *Magic Link* — until 21 September that one was
still Supabase's default ("Confirm your email address", "Follow this link to
confirm your user"), so every new visitor's first email looked like somebody
else's.

The link is

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}
```

- `type=email` covers both templates: Supabase looks the hash up as a
  confirmation token or a recovery (magic link) token.
- `{{ .SiteURL }}`, not `{{ .RedirectTo }}`, as the host: every sign-in email
  lands on `https://livd.site`, whatever environment asked for it.
- `next` is the address Livd passed as `emailRedirectTo`. `/auth/confirm` takes
  only a Livd path from it, through `safeNextPath`.

The file is the source of truth; the dashboard can drift. Change the file,
then apply it to both templates. `tests/auth/sign-in-template.test.ts` asserts
the link shape, that `{{ .ConfirmationURL }}` is gone, and that the file says
nothing Supabase-branded.

What the email is checked against — tables, inline styles, both colour schemes
(light in the markup, dark in a `prefers-color-scheme` block), and a logo in
three elements because Gmail honours neither that query nor the `color-scheme`
meta and inverts the message on its own account — is described in the file's
header comment. The short version: a client that says which ground it is on
gets the official file for it, and Gmail gets the wordmark as type, which is
the only thing that inverts along with the ground beneath it.

---

## 4. Lifetime and rate limits

**Authentication → Emails** (OTP expiry) and **Authentication → Rate Limits**

| Setting | Live value | Why |
| --- | --- | --- |
| `mailer_otp_exp` — link and code lifetime | **3600 s** (was 900) | Supabase's default. Fifteen minutes turned slow mail and app-switching into "expired"; an hour is still one-time and short. `SIGN_IN_EMAIL.lifetimeMinutes` in `src/config/site.ts` must match — the interface quotes it |
| `mailer_otp_length` | 8 | Eight digits, ten tries per address per fifteen minutes (`authCodeVerify`) |
| `smtp_max_frequency` — per-address interval | 60 s | Stops one address being flooded. `SIGN_IN_EMAIL.cooldownSeconds` matches it so the resend button counts down to the moment Supabase will accept |
| `rate_limit_email_sent` — sign-in emails per hour, project-wide | 30 | See below |
| `rate_limit_otp`, `rate_limit_verify` — per IP, per 5 minutes | 30, 30 | Requests reach Supabase from Vercel's egress addresses, not the visitor's, so these are shared; Livd's own limits are per person |

**Why 30 emails an hour, and not more.** Resend is on the Free plan: 100 emails
a day and 3,000 a month, shared with every notification Livd sends. Thirty an
hour already allows more than Resend will deliver in a day, so raising it
creates no capacity — it only lets one bad hour spend the whole day's quota,
notifications included. When Resend moves to a paid plan (no daily cap), raise
this to 100–150 an hour.

Livd adds its own limits in front (`src/lib/safety/rate-limit.ts`): six requests
per address per fifteen minutes, twenty per origin per hour — so one visitor
cannot spray links at strangers and spend the project's allowance.

---

## 5. Checking it

**The link and sender** — request a link to an inbox you can read, and open the
original message:

- `From: Livd <notifications@livd.site>`, subject `Your Livd sign-in link`,
  whether the address is new or not;
- `Authentication-Results`: `dkim=pass header.i=@livd.site`,
  `dmarc=pass header.from=livd.site`;
- the button's link starts `https://livd.site/auth/confirm?token_hash=` — not
  `supabase.co`, not a tracking host.

**The flow** — open the link in a *different* browser from the one that asked.
It should show "Finish signing in", and one tap should sign in there.

**The config** — `GET /v1/projects/{ref}/config/auth` with a Management API
token, or the dashboard pages named above.
