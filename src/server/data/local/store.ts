import 'server-only';

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  ModerationAction,
  OwnerResponse,
  Property,
  PropertyClaim,
  PropertyFlagKind,
  PropertyFlagStatus,
  Review,
  ReviewReport,
  SavedProperty,
  UserProfile,
} from '@/types/domain';
import { generateSeed } from './seed';

/**
 * The local adapter's storage.
 *
 * A JSON document on disk, loaded once and held in memory. Writes are
 * serialised through a promise chain so two concurrent Server Actions cannot
 * interleave a read-modify-write and lose one of them.
 *
 * This is a development and evaluation store, not a production database — which
 * is exactly why it refuses to run in production rather than quietly becoming
 * one.
 */

export interface LocalDatabase {
  version: number;
  properties: Property[];
  reviews: Review[];
  users: UserProfile[];
  reports: ReviewReport[];
  claims: PropertyClaim[];
  ownerResponses: OwnerResponse[];
  moderationActions: ModerationAction[];
  /**
   * Decisions on burst-detection flags.
   *
   * The flags themselves are derived on read rather than stored — there is no
   * scheduler here to write them — so only the moderator's verdict needs
   * keeping, and it is keyed by what the flag is about rather than by an id
   * that would change on every recomputation.
   */
  flagDecisions: Array<{
    propertyId: string;
    kind: PropertyFlagKind;
    status: Exclude<PropertyFlagStatus, 'open'>;
    reviewedBy: string;
    reviewedAt: string;
  }>;
  saved: SavedProperty[];
  helpfulVotes: Array<{ reviewId: string; voterId: string }>;
  searchEvents: Array<{
    queryHash: string;
    countryCode: string | null;
    locality: string | null;
    resultCount: number;
    occurredAt: string;
  }>;
}

const DATA_DIR = join(process.cwd(), '.data');
const DATA_FILE = join(DATA_DIR, 'livd.json');
const SCHEMA_VERSION = 1;

let cache: LocalDatabase | null = null;
let loading: Promise<LocalDatabase> | null = null;
/** Serialises writes. Every mutation appends to this chain. */
let writeQueue: Promise<unknown> = Promise.resolve();

function emptyDatabase(): LocalDatabase {
  return {
    version: SCHEMA_VERSION,
    properties: [],
    reviews: [],
    users: [],
    reports: [],
    claims: [],
    ownerResponses: [],
    moderationActions: [],
    flagDecisions: [],
    saved: [],
    helpfulVotes: [],
    searchEvents: [],
  };
}

function seededDatabase(): LocalDatabase {
  const database = emptyDatabase();
  if (process.env.LIVD_SHOW_DEMO_DATA === 'false') return database;

  const seed = generateSeed();
  database.properties = seed.properties;
  database.reviews = seed.reviews;
  database.users = seed.users;
  return database;
}

async function persist(database: LocalDatabase): Promise<void> {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(database), 'utf8');
}

async function loadDatabase(): Promise<LocalDatabase> {
  if (process.env.NODE_ENV === 'production' && process.env.LIVD_ALLOW_LOCAL_IN_PROD !== 'true') {
    throw new Error(
      'The local data adapter is not a production store. Configure Supabase ' +
        '(NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY) and set ' +
        'LIVD_DATA_BACKEND=supabase. See .env.example.',
    );
  }

  try {
    const raw = await readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw) as LocalDatabase;

    if (parsed.version === SCHEMA_VERSION) {
      // Merge in any keys added since the file was written.
      return { ...emptyDatabase(), ...parsed };
    }
    // A schema change reseeds rather than attempting a migration — this store
    // holds nothing that is not reproducible.
  } catch {
    // No file yet, or it is unreadable. Either way, start from the seed.
  }

  const database = seededDatabase();
  await persist(database);
  return database;
}

/** Reads the database, loading it on first use. */
export async function getDatabase(): Promise<LocalDatabase> {
  if (cache) return cache;
  if (!loading) {
    loading = loadDatabase().then((database) => {
      cache = database;
      loading = null;
      return database;
    });
  }
  return loading;
}

/**
 * Applies a mutation and persists it.
 *
 * Every write goes through here, appended to a single queue, so concurrent
 * requests serialise rather than racing.
 */
export async function mutate<T>(fn: (database: LocalDatabase) => T | Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const database = await getDatabase();
    const result = await fn(database);
    await persist(database);
    return result;
  };

  const next = writeQueue.then(run, run);
  // Keep the chain alive even when a mutation rejects.
  writeQueue = next.catch(() => undefined);
  return next;
}

/** Test helper — discards the in-memory copy so the next read reloads. */
export function resetCache(): void {
  cache = null;
  loading = null;
  writeQueue = Promise.resolve();
}
