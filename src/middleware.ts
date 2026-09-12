import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { PATHNAME_HEADER } from '@/lib/auth/request-path';

/**
 * Keeps a Supabase session alive across requests.
 *
 * A Server Component cannot set cookies. Supabase access tokens are short-lived
 * and are renewed by exchanging a refresh token, which means writing a new
 * cookie — so without a middleware there is nowhere for that write to happen,
 * and a signed-in visitor is quietly signed out the first time their token
 * ages out. `supabase-client.ts` has carried a comment saying refresh "happens
 * in the middleware" since Phase 1; this is that middleware.
 *
 * It does one other thing, and it is not authorisation: it copies the request's
 * own path onto a header, because a layout cannot otherwise learn it.
 *
 * That matters for exactly one behaviour. `requireRolePage` is called in the
 * admin layout, which does not know which admin page is being rendered, so it
 * passed a hard-coded `/admin` as the destination to return to. A moderator
 * following an emailed link to a case therefore signed in and landed on the
 * dashboard, with the case they had been sent to nowhere in sight. Now the
 * guard reads the real path and sends them where they were going.
 *
 * No route protection lives here. The guards in `src/server/auth/guards.ts`
 * decide who may see what, and Row Level Security decides it again in the
 * database. A middleware that also authorised would be a third opinion running
 * before either of them — and a header is not a decision.
 */


export async function middleware(request: NextRequest): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Set before the early return, so the local adapter gets it too — otherwise
  // the sign-in destination would be right in production and wrong in
  // development, which is the worst way round.
  const headers = new Headers(request.headers);
  headers.set(PATHNAME_HEADER, request.nextUrl.pathname + request.nextUrl.search);

  // The local development adapter signs its own cookie and has no tokens to
  // refresh. Nothing to do, and nothing to fail.
  if (!url || !key || process.env.LIVD_DATA_BACKEND === 'local') {
    return NextResponse.next({ request: { headers } });
  }

  let response = NextResponse.next({ request: { headers } });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Written onto the request so this request's own handlers see the fresh
        // token, and onto the response so the browser keeps it.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request: { headers } });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // The call itself is the point: `getUser` validates the token with Supabase
  // and refreshes it when it has expired, which triggers `setAll` above. The
  // result is deliberately unused — deciding anything here would duplicate the
  // guards.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Every path except the ones that can never carry a session: Next's own
     * build output, the image optimiser, and files with an extension. Running
     * on those would refresh a token on the way to a favicon.
     *
     * `manifest.webmanifest` is named rather than matched by extension, which
     * is the whole reason it needs naming — it is fetched on first paint by
     * every browser that supports installing a site.
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
