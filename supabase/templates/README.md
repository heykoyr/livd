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

| Field | Set to | Status |
| --- | --- | --- |
| Site URL | `https://livd-psi.vercel.app` | **done** — verified 7 September 2026 |
| Redirect URLs | `http://localhost:3000/**` | outstanding, and now needed |

Sub-paths of the Site URL are allow-listed implicitly — probing GoTrue with a
throwaway token shows `https://livd-psi.vercel.app/auth/callback?next=%2Freview`
honoured in full while `https://evil.example/steal` falls back. So production
needed only the Site URL.

The consequence is that **localhost is no longer an allowed redirect**. That
does not affect ordinary local development, which runs `LIVD_DATA_BACKEND=local`
and never touches Supabase Auth — but running the Supabase backend locally now
needs `http://localhost:3000/**` on the Redirect URLs list.

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
`NEXT_PUBLIC_SITE_URL` in Vercel have to change together.

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
  email provider for magic links" as a pre-launch item since Phase 7.
- Custom SMTP is what changes the sender name.

**When SMTP is configured, set:**

| Field | Value |
| --- | --- |
| Sender email | an address at a domain Livd controls and has verified |
| Sender name | `Livd` |

Do not put a made-up address here. It must be a domain with SPF and DKIM
records that the provider has verified, or the mail will land in spam — which
is a worse outcome than saying "Supabase Auth".

Until that domain exists, none of it changes: recipients see "Supabase Auth"
and Supabase's own default wording. The template in §3 is written and waiting;
it cannot be applied first.

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
