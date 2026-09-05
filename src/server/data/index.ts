import 'server-only';

import { resolveDataBackend } from '@/config/site';
import type { LivdRepository } from './repository';
import { LocalRepository } from './local';

export type { LivdRepository } from './repository';
export * from './repository';

/**
 * Resolves the active repository.
 *
 * The Supabase adapter is imported lazily so a local-only development install
 * never pulls the client into the server bundle, and a misconfigured Supabase
 * environment fails with the message from `resolveDataBackend` rather than an
 * opaque import error.
 */

let instance: LivdRepository | null = null;
let pending: Promise<LivdRepository> | null = null;

async function create(): Promise<LivdRepository> {
  const backend = resolveDataBackend();

  if (backend === 'supabase') {
    const { SupabaseRepository } = await import('./supabase');
    return new SupabaseRepository();
  }

  return new LocalRepository();
}

export async function getRepository(): Promise<LivdRepository> {
  if (instance) return instance;
  if (!pending) {
    pending = create().then((repository) => {
      instance = repository;
      pending = null;
      return repository;
    });
  }
  return pending;
}

/** Test helper — forces the next `getRepository` call to rebuild. */
export function resetRepository(): void {
  instance = null;
  pending = null;
}
