import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

/**
 * Supabase clients.
 *
 * Two, with a strict division:
 *
 *   `createServerSupabaseClient` uses the publishable anon key and carries the
 *   signed-in user's JWT, so every query it makes is constrained by Row Level
 *   Security. This is the client that serves user requests.
 *
 *   `createServiceRoleClient` bypasses RLS entirely. It exists for moderation
 *   and verification work that must read across users, and it is guarded so it
 *   can never be constructed from a client bundle.
 *
 * The anon key being public is fine and by design — RLS is what protects the
 * data, not the secrecy of that key. The service-role key is the opposite: it
 * is the only true secret in the application.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}

export async function createServerSupabaseClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. Session refresh happens in
            // the middleware and in Server Actions, both of which can.
          }
        },
      },
    },
  );
}

/**
 * Service-role client. Server-only, and never for a request whose authorisation
 * has not already been checked by a guard.
 */
export function createServiceRoleClient(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('The service-role client must never be constructed in the browser.');
  }

  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
