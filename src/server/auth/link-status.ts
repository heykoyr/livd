import 'server-only';

import { createHash } from 'node:crypto';

import { resolveDataBackend } from '@/config/site';
import type { SpentLinkEvidence } from '@/lib/auth/sign-in-failures';

/**
 * What happened to a sign-in token after GoTrue refused it, and the record
 * that makes "already used" answerable. See migration 0051 for why both exist.
 *
 * Both calls are best-effort and run only *after* a verification has decided
 * everything that matters. A failure here can make a message less specific;
 * it can never sign anyone in or keep anyone out.
 */

function serviceRoleAvailable(): boolean {
  return resolveDataBackend() === 'supabase' && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function lookUpSpentLink(tokenHash: string): Promise<SpentLinkEvidence> {
  if (!serviceRoleAvailable()) return 'unknown';

  try {
    const { createServiceRoleClient } = await import('./supabase-client');
    const { data, error } = await createServiceRoleClient().rpc('livd_sign_in_link_status', {
      p_token_hash: tokenHash,
    });
    if (error) return 'unknown';
    return data === 'present' || data === 'used' ? data : 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function recordRedeemedLink(tokenHashes: string[]): Promise<void> {
  if (!serviceRoleAvailable() || tokenHashes.length === 0) return;

  try {
    const { createServiceRoleClient } = await import('./supabase-client');
    await createServiceRoleClient().rpc('livd_record_sign_in_link_redemption', {
      p_token_hashes: tokenHashes,
    });
  } catch {
    // Losing this only means a second tap on the same link is described as
    // "no longer valid" rather than "already used". Not worth failing a
    // sign-in that has already succeeded.
  }
}

/**
 * The token hashes a typed code corresponds to.
 *
 * GoTrue stores SHA-224 of the address followed by the code, prefixed `pkce_`
 * when the request used PKCE. Recording both forms means a link whose code was
 * typed instead is still recognised as used if the link is tapped afterwards.
 */
export function tokenHashesForCode(email: string, code: string): string[] {
  const hash = createHash('sha224').update(`${email}${code}`).digest('hex');
  return [hash, `pkce_${hash}`];
}
