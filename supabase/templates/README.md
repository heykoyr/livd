# Auth email — what has to be set by hand

Supabase exposes no API for Auth URL configuration, email templates or the
sender identity. Everything in this file is a dashboard change. Nothing in the
repository can make it happen, and nothing in the repository should pretend to.

The application code is already correct: `src/app/auth/callback/route.ts`
exchanges the code, `src/middleware.ts` keeps the session alive, and
`src/server/actions/auth.ts` asks for an absolute redirect built from
`SITE.url`. What follows is the half that lives in Supabase.

---

## 1. URL configuration — this is what caused the localhost redirect

**Authentication → URL Configuration**

| Field | Set to |
| --- | --- |
| Site URL | `https://livd-psi.vercel.app` |
| Redirect URLs | `https://livd-psi.vercel.app/auth/callback`<br>`http://localhost:3000/auth/callback`<br>`https://*-koyrstudio.vercel.app/auth/callback` |

**Why the Site URL matters more than it looks.** When Livd asks for a magic
link it passes `emailRedirectTo`. If that URL is not on the Redirect URLs list,
GoTrue does not error — it silently substitutes the Site URL. The Site URL was
still Supabase's default, `http://localhost:3000`, which is exactly what the
link in the email pointed at. Fixing the application alone would not have
fixed the email.

The third entry is the preview-deployment wildcard. Drop it if you would rather
previews not sign anyone in; the flow still works everywhere else.

When a custom domain replaces the Vercel one, both the Site URL here and
`NEXT_PUBLIC_SITE_URL` in Vercel have to change together.

---

## 2. Sender name — "Supabase Auth" → "Livd"

**Project Settings → Authentication → SMTP Settings**

With Supabase's built-in sender there is no way to change the display name: the
address is `noreply@mail.app.supabase.io` and the name is fixed. The sender is
part of the deliverability arrangement, not a branding field, so this cannot be
solved from the application.

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

Until that domain exists, the sender stays as it is. The email body below is
still worth applying: the content is what a recipient reads, and it can be
branded before the envelope can.

---

## 3. The email itself

**Authentication → Emails → Magic Link**

- **Subject:** `Your sign-in link`
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
(`copy.auth.linkSentBody`). Supabase's default OTP expiry is 3600 seconds.
Either set the expiry to 900 to match what the product says, or change the
copy — but they should agree, because one of them is currently wrong.
