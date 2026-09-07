/**
 * Where a sign-in is allowed to send you afterwards.
 *
 * The magic-link flow carries a destination through an email and back, which is
 * exactly the shape of an open redirect: a link that looks like Livd, arrives
 * from Livd, and lands somewhere else. Every place that reads a `next`
 * parameter — the sign-in page, the action that sends the link, the callback
 * that completes it — goes through this one function, so there is one rule
 * rather than three copies of a rule.
 *
 * Only a same-origin path is ever returned. Not a URL with a host, not a
 * protocol-relative path, not a backslash the browser will normalise into one.
 */

/** Where someone lands when they have not asked for anywhere in particular. */
export const DEFAULT_SIGNED_IN_PATH = '/';

export function safeNextPath(value: string | null | undefined): string {
  if (!value) return DEFAULT_SIGNED_IN_PATH;

  // Must be a path on this site.
  if (!value.startsWith('/')) return DEFAULT_SIGNED_IN_PATH;

  // `//evil.example` is protocol-relative: the browser reads it as a host.
  // `/\evil.example` is the same attack — several browsers normalise the
  // backslash to a forward slash before parsing.
  if (value.startsWith('//') || value.startsWith('/\\')) return DEFAULT_SIGNED_IN_PATH;

  // A control character can truncate the header a browser eventually parses.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return DEFAULT_SIGNED_IN_PATH;

  // Long enough for any real route, short enough not to be a payload.
  if (value.length > 500) return DEFAULT_SIGNED_IN_PATH;

  // Sending someone back to the sign-in page after signing in is a loop.
  if (value === '/sign-in' || value.startsWith('/sign-in?')) return DEFAULT_SIGNED_IN_PATH;

  // Nor to the callback, which would have no code to exchange the second time.
  if (value.startsWith('/auth/')) return DEFAULT_SIGNED_IN_PATH;

  return value;
}
