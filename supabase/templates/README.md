# Auth email — what has to be set by hand

Supabase exposes no API for Auth URL configuration, email templates or the
sender identity. Everything in this file is a dashboard change. Nothing in the
repository can make it happen, and nothing in the repository should pretend to.

**Read §2 before §3.** On the built-in email sender the dashboard locks the
subject *and* the body: "Set up custom SMTP to edit templates". Custom SMTP is
therefore the gate on all of it — the sender name, the subject and the HTML —
not just the sender name, which is what an earlier version of this file
implied.

The application code is already correct: `src/app/auth/callback/route.ts`
exchanges the code, `src/middleware.ts` keeps the session alive, and
`src/server/actions/auth.ts` asks for an absolute redirect built from
`SITE.url`. What follows is the half that lives in Supabase.

---

## 1. URL configuration — this is what caused the localhost redirect

**Authentication → URL Configuration**

Probed from outside on 16 September 2026 with `npm run domain:check`, which
reports the live values rather than what anybody remembers setting:

| Field | Currently | Must become | Status |
| --- | --- | --- | --- |
| Site URL | `https://livd-koyrstudio.vercel.app` | `https://livd.site` | **outstanding** |
| Redirect URLs | `http://localhost:3000/**` | keep, and add `https://livd.site/**` and `https://www.livd.site/**` | **outstanding** |

An earlier version of this file recorded the Site URL as
`https://livd-psi.vercel.app`. It is not, and has not been for some time —
both are aliases of the same deployment, which is exactly why nobody noticed.
Do not trust this table; run the check.

Sub-paths of the Site URL are allow-listed implicitly — probing GoTrue with a
throwaway token shows `https://livd-koyrstudio.vercel.app/auth/callback?next=%2Freview`
honoured in full while `https://not-allowed.example/x` falls back. So
production has needed only the Site URL so far.

**Order matters, and getting it wrong is silent.** Add the two `livd.site`
entries to the Redirect URLs list *first*: that step is purely additive and
breaks nothing while the old host is still the Site URL. Only then change the
Site URL and `NEXT_PUBLIC_SITE_URL` in Vercel, which are one change in two
places. Doing the Vercel half alone produces sign-in links that work and land
the person on the old origin, signed out, with nothing logged. See
[`docs/domain.md`](../../docs/domain.md).

Local development must keep working: `http://localhost:3000/**` stays on the
list. Removing it to tidy up would be a regression, and `npm run domain:check`
asserts it is still there.

Add `https://*-koyrstudio.vercel.app/**` too if preview deployments should be
able to sign anyone in.

**How to check this without sending an email.** GoTrue validates `redirect_to`
against the allow list before it redirects, even for a token it will reject.
Point it at an origin that can never be allowed and whatever it falls back to
*is* the Site URL:

```bash
curl -sI -H "apikey: $ANON_KEY" \n  "$SUPABASE_URL/auth/v1/verify?token=probe&type=magiclink&redirect_to=https%3A%2F%2Fnot-allowed.example%2Fx" \n  | grep -i '^location'
```

**Why the Site URL matters more than it looks.** When Livd asks for a magic
link it passes `emailRedirectTo`. If that URL is not on the Redirect URLs list,
GoTrue does not error — it silently substitutes the Site URL. The Site URL was
still Supabase's default, `http://localhost:3000`, which is exactly what the
link in the email pointed at. Fixing the application alone would not have
fixed the email.

When a custom domain replaces the Vercel one, both the Site URL here and
`NEXT_PUBLIC_SITE_URL` in Vercel have to change together. That is happening
now: the domain is `livd.site`.

---

## 2. Custom SMTP — the gate on everything below

**Project Settings → Authentication → SMTP Settings**

Until this is configured, Supabase sends its own default template and the
dashboard disables both the Subject and Body fields on the Magic Link page:
*"Emails will be sent using the default templates. Set up custom SMTP to edit
their subject and body."* The sender is likewise fixed at
`noreply@mail.app.supabase.io`, displayed as "Supabase Auth".

So this single setting gates three things at once — the sender name, the
subject and the HTML in §3. None of them can be changed from the application,
and none of them can be changed from the dashboard either while the built-in
sender is in use.

Two things follow from that, and they are the same thing:

- The built-in sender is rate-limited to a handful of emails per hour and is
  explicitly not intended for production. `docs/roadmap.md` has listed "an
  email provider for magic links" as a pre-launch item since Phase 7. This is
  not theoretical: on 7 September 2026, testing the newly-fixed flow hit it
  four times inside four minutes —

  ```
  429: email rate limit exceeded   (over_email_send_rate_limit)   POST /otp
  ```

  Livd surfaces that specifically now rather than as a generic failure, but
  the limit itself only lifts with custom SMTP.
- Custom SMTP is what changes the sender name.

**When SMTP is configured, set:**

| Field | Value |
| --- | --- |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | a Resend API key with sending permission |
| Sender email | `notifications@livd.site` |
| Sender name | `Livd` |

Resend is already Livd's transactional provider, so pointing Supabase's SMTP
at it means one verified domain, one reputation and one place to read a
delivery log — rather than a second provider existing solely to send the one
email Supabase owns.

**Use a separate API key from the application's.** Same account, same verified
domain, different key. Supabase stores it in its own dashboard, and a key that
lives in two services cannot be rotated in one of them.

The domain has to be verified in Resend first — `notifications@livd.site` will
be refused with a 403 until it is. See [`docs/email.md`](../../docs/email.md).

Until then, none of it changes: recipients see "Supabase Auth" and Supabase's
own default wording. The template in §3 is written and waiting; it cannot be
applied first.

---

## 3. The email itself

**Authentication → Emails → Magic Link**

*Both fields are disabled until custom SMTP is configured — see §2.*

- **Subject:** `Your sign-in link` (which is also Supabase's default, so the
  subject line already reads correctly today)
- **Body:** the contents of [`magic-link.html`](./magic-link.html)

That file is the source of truth. The dashboard has no API, so the two can
drift — change the file first, then paste it.

It uses `{{ .ConfirmationURL }}`, which is Supabase's own token. It carries the
PKCE code and the redirect Livd asked for. Do not build a URL by hand in the
template: single use and expiry are properties of that token, and a
hand-assembled link would have neither.

### What it is checked against

Tables and inline styles throughout, because Outlook on Windows renders through
Word and Gmail strips `<style>` blocks in several views. The `<style>` block
carries only the dark-mode overrides and one media query, both of which fall
back to the inline light values when removed. No images: nothing to block,
nothing to fail, and a sign-in email that loads no remote content is a
sign-in email that cannot be tracked. Georgia stands in for Newsreader, which
no mail client will load.

---

## 4. Link lifetime

**Authentication → Providers → Email**

The sign-in page tells people the link "expires in 15 minutes"
(`copy.auth.linkSentBody`), and Supabase's default was 3600 seconds. Set to 900
on 7 September 2026 so the two agree. If either moves, move the other.
