import 'server-only';

/**
 * Sign-in diagnostics that are safe to keep.
 *
 * A failed sign-in has to leave enough behind to be diagnosed without anyone
 * reaching for Supabase's own logs — which is how the cross-browser failure
 * was eventually found — and must leave nothing behind that could sign
 * somebody in. So the shape is fixed and short:
 *
 *   event     what was being attempted
 *   outcome   Livd's category for the result (see `sign-in-failures.ts`)
 *   route     which endpoint
 *   provider  Supabase's error code and HTTP status, never its message
 *   env       production, preview or development
 *
 * Deliberately impossible to pass through this function: a link, a code, a
 * token hash, a PKCE verifier, a session token, or an email address. Which
 * addresses tried to sign in is the kind of record Livd exists not to keep,
 * and anything in the other list is a credential.
 */

export interface AuthLogEntry {
  event:
    | 'link_request'
    | 'link_verify'
    | 'code_verify'
    | 'code_exchange'
    | 'oauth_start';
  outcome: string;
  route: string;
  providerCode?: string | undefined;
  providerStatus?: number | undefined;
}

export function logAuthEvent(level: 'info' | 'warn' | 'error', entry: AuthLogEntry): void {
  const record = {
    at: new Date().toISOString(),
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
    event: entry.event,
    outcome: entry.outcome,
    route: entry.route,
    // Codes are a fixed vocabulary (`otp_expired`, `bad_code_verifier`, …).
    // Anything longer than a code is dropped rather than trusted.
    providerCode: entry.providerCode && /^[a-z_]{1,64}$/.test(entry.providerCode)
      ? entry.providerCode
      : undefined,
    providerStatus: entry.providerStatus,
  };

  const line = `[livd:auth] ${JSON.stringify(record)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}
