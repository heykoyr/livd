# Livd — the production domain

Livd is served from **`https://livd.site`**. This is how, why that host and not
another, and what has to be true at four different providers before it works.

```bash
npm run domain:check
```

Asks DNS, Vercel, Supabase and Resend from outside and prints one table. It is
the answer to "is the domain done yet" — not a guess, and not "DNS is probably
still propagating".

---

## 1. The canonical host is the apex

`livd.site`, not `www.livd.site`.

Livd's public surface is property records that people share, paste into
messages and find in search results. Those URLs are read by humans, and the
shorter one reads better — `livd.site/property/the-franklin-brooklyn` is
already long enough. There is no technical argument the other way at Livd's
size: the historical reason to prefer `www` is being able to CNAME the public
host away from the apex, and Vercel's apex A records make that moot.

`www.livd.site` is registered on the project and **308-redirects to the apex**.
Not a rewrite and not a second origin serving the same pages — two hosts
serving identical content is a duplicate-content problem that a canonical tag
only half fixes.

The redirect is configured on the Vercel domain itself, not in
`src/middleware.ts`. Vercel answers it at the edge before any function is
invoked, so it costs no compute and no cold start, and the middleware stays a
session-refresh concern rather than becoming a router.

**308, not 301.** A 308 preserves the request method, so a POST to a `www` URL
— a Server Action from a stale tab — is replayed as a POST rather than
silently downgraded to a GET that loses the body.

---

## 2. DNS lives at Namecheap, and the mail records must survive

The domain is registered at Namecheap and uses **Namecheap BasicDNS**
(`dns1.registrar-servers.com` / `dns2.registrar-servers.com`). Records are
managed at **Domain List → livd.site → Advanced DNS**.

**The nameservers are deliberately not moved to Vercel.** Moving them would
hand Vercel a zone that already contains records Vercel knows nothing about —
five MX records and an SPF record for Namecheap's free email forwarding — and
every one of them would have to be recreated by hand on the other side. The
upside would be managing the zone from one place. The downside is that the
window in which it goes wrong is the window in which `support@livd.site` stops
reaching anybody. Not worth it.

### What has to be there

| Type | Host | Value | Purpose |
| --- | --- | --- | --- |
| A | `@` | `216.198.79.1` | Vercel — apex |
| A | `@` | `64.29.17.1` | Vercel — apex |
| CNAME | `www` | `d2a7240fb63a4b15.vercel-dns-017.com.` | Vercel — www, which then redirects |
| MX | `@` | `eforward1–5.registrar-servers.com` (10/10/10/15/20) | **Existing.** Namecheap email forwarding |
| TXT | `@` | `v=spf1 include:spf.efwd.registrar-servers.com ~all` | **Existing.** SPF for the forwarder |

The two A values and the CNAME target are what `vercel domains verify
livd.site` returned for *this project* on 16 September 2026. They are
project-specific; Vercel's published generic answer, a single A record to
`76.76.21.21`, is its own rank-2 fallback and also works. Do not copy values
out of a blog post — ask the CLI.

### What has to go

| Type | Host | Value | Why |
| --- | --- | --- | --- |
| A | `@` | `162.255.119.196` | Namecheap's parking page. It is what `livd.site` resolved to before this migration, and it is the record the Vercel A records replace. |

### What must not be touched

The five MX records and the apex SPF TXT record. They are the Namecheap email
forwarding that makes `support@livd.site` and `hello@livd.site` reach a real
inbox, and they are unrelated to hosting. `npm run domain:check` asserts they
are still there, because replacing the apex A record is exactly the moment
they get deleted by accident.

**There must be exactly one SPF record on the apex.** A second one is not
additive — receivers are entitled to treat two SPF records on a name as a
permanent error and fail every message. Resend does not need one added, which
is the subject of [`email.md`](email.md).

---

## 3. SSL

Vercel issues and renews the certificate automatically once the A records
resolve, for both the apex and `www`. Nothing to configure and nothing to
renew.

`next.config.ts` already sends
`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` and
`upgrade-insecure-requests` in the CSP, so there is no HTTP surface to
downgrade to once the certificate exists. Every asset Livd serves is
first-party — fonts are self-hosted by `next/font`, there are no third-party
scripts — so there is no mixed-content risk to audit.

---

## 4. The order these have to happen in

This is the part that bites, and it is the reason the environment variable is
flipped last rather than first.

Supabase does not reject a `redirect_to` it will not honour. It **silently
substitutes its own Site URL**. So a production build that has been told it
lives at `https://livd.site`, talking to a Supabase project whose allow list
has never heard of `livd.site`, produces sign-in emails whose links work
perfectly and land the person on `livd-koyrstudio.vercel.app` — a different
origin, with a different cookie jar, where they appear signed out. Nothing
errors. Nothing is logged.

So:

1. **DNS at Namecheap.** Apex A records and the `www` CNAME. Nothing else can
   be verified until `livd.site` resolves to Vercel.
2. **Wait for the certificate.** `npm run domain:check` reports it.
3. **Supabase allow list.** Add `https://livd.site/**` and
   `https://www.livd.site/**` to Redirect URLs. This step is purely additive —
   it breaks nothing while the old host is still the Site URL, which is why it
   can be done early and should be.
4. **Supabase Site URL → `https://livd.site`**, and
   **`NEXT_PUBLIC_SITE_URL` → `https://livd.site`** in Vercel Production.
   These two are one change in two places. Doing either alone is the bug
   above.
5. **Redeploy.** `NEXT_PUBLIC_*` is inlined at build time; an environment edit
   does nothing until the next build.
6. `npm run domain:check` should be green.

The application is already correct for all of it. `SITE.url` resolves the
canonical origin on a production build even if `NEXT_PUBLIC_SITE_URL` were
lost entirely — see `src/config/site.ts` — so step 4's Vercel half is belt to
the code's braces rather than the only thing holding it up.

---

## 5. The old Vercel hostnames stay

`livd-koyrstudio.vercel.app` and `livd-git-main-koyrstudio.vercel.app` are not
removed.

They are Vercel's own aliases for the project and removing them buys nothing:
they are not in the sitemap, not in `robots.txt` — whose `host` line names the
canonical origin — and not in any link Livd generates, because every public
link is built from `SITE.url`. A crawler that reaches one finds pages whose
canonical tag points at `livd.site`, which is the correct signal and the one
Google acts on.

What they do buy is a working deployment URL if DNS ever breaks, and preview
deployments that keep functioning. Preview builds resolve `VERCEL_URL` and
serve themselves, exactly as before.

---

## 6. Environments

| | Origin | How it is decided |
| --- | --- | --- |
| Production | `https://livd.site` | `NEXT_PUBLIC_SITE_URL`, falling back to the canonical constant when `VERCEL_ENV=production` |
| Preview | `https://<deployment>.vercel.app` | `VERCEL_URL` |
| Development | `http://localhost:3000` | the final fallback |

Local development is unchanged and must stay that way. `localhost:3000` is
still on Supabase's Redirect URLs list and `npm run domain:check` asserts it —
removing it to make production work would be a regression, not a cleanup.

---

## 7. The apex was held by a deleted redirect — 17 September 2026

For a day `livd.site` resolved to `159.198.67.201` while the Namecheap
Advanced DNS page showed the two Vercel A records, correctly entered. It was
not propagation, and it was not a mistake in the records.

### What the evidence was

| Question | Answer |
| --- | --- |
| Do both authoritative servers agree? | Yes — `dns1`/`dns2.registrar-servers.com` both return `159.198.67.201` |
| Is the zone stale or frozen? | No. The SOA serial moved `1789527043 → 1789645214` across the edits |
| Do UI edits reach the zone at all? | **Yes** — `www.livd.site` CNAME → `d2a7240fb63a4b15.vercel-dns-017.com` was live |
| Was it the classic host-field mistake? | No — `livd.site.livd.site` is NXDOMAIN |
| A conflicting CNAME, AAAA or wildcard at the apex? | None |
| What is `159.198.67.201`? | rDNS `poleward-expiratory.rdns.hosting.namecheap.net` |
| What does it serve? | `Server: APISIX`, cert `CN=livd.site` issued by SSL.com |
| Where does it redirect? | `308 → https://livd.site/` — **to itself** |

The `www` row is the one that settles it. The same UI, the same zone, the same
save: one record published and the other did not. So the interface is not out
of sync with the backend — the apex specifically is owned by something else.

`APISIX` is the gateway behind **Namecheap's URL Redirect service**, and the
SSL.com certificate is the one that service provisions (Vercel issues Let's
Encrypt — `www` has exactly that). A redirect whose `Location` is its own URL
is a redirect record whose destination has been cleared while the record
itself still exists. Deleting the row in Advanced DNS removed it from the
display and from the zone's *visible* records; it did not deprovision the
service, which still holds the apex and still answers on it.

That is also why it was hard to see: a parking page would have been obvious on
sight. An infinite 308 loop looks like a misconfigured site.

### What it was not

The hosting package is a red herring. `server146.web-hosting.com` resolves to
`162.213.255.39`, which is not the address the apex points at — the cPanel
account is not what is holding the name, even though it shares Namecheap's
`hosting.namecheap.net` rDNS space.

### Everything downstream was already correct

`www.livd.site` served from Vercel throughout, with a valid Let's Encrypt
certificate and the 308 to the apex working exactly as configured. Supabase's
Site URL and redirect allow list are correct. The only broken thing was the
apex A record, and every other failing check was a consequence of it.

`identifyHolder()` in `scripts/domain-readiness.mjs` now performs this
diagnosis automatically: when the apex is not Vercel's it opens a socket at
the address DNS returned, sets the `Host` header by hand, and names whoever
answers — rather than reporting the useless truth that it is "not a Vercel
address".
