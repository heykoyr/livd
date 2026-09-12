import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The author pseudonym.
 *
 * Phase 13 found `reviews.author_id` readable by every client role, `anon`
 * included. One unauthenticated query returned an account identifier for all
 * 222 published reviews, resolving to 120 distinct authors; an approved owner
 * got the pseudonym behind all 23 reviews of their own building.
 *
 * A UUID is not a name, and it is tempting to file that as pseudonymous rather
 * than identifying. That is the wrong conclusion. Anonymity is not only "your
 * name is not printed" — it is also that two reviews cannot be tied to the same
 * person. A stable per-author key on a public row breaks the second half
 * completely: group everything one person has written, cross it with tenure,
 * rent and locality, and an owner who already suspects which review is whose
 * learns which *other* buildings that person reviewed.
 *
 * This file holds the invariant at every layer the application controls.
 */

const original = { cwd: process.cwd(), backend: process.env.LIVD_DATA_BACKEND };
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'livd-pseudonym-'));
  process.chdir(workDir);
  process.env.LIVD_DATA_BACKEND = 'local';
  process.env.LIVD_SHOW_DEMO_DATA = 'false';
});

afterAll(async () => {
  process.chdir(original.cwd);
  if (original.backend === undefined) delete process.env.LIVD_DATA_BACKEND;
  else process.env.LIVD_DATA_BACKEND = original.backend;
  await rm(workDir, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.resetModules();
  const { resetCache } = await import('@/server/data/local/store');
  resetCache();
  await rm(join(workDir, '.data'), { recursive: true, force: true });
});

async function sourceOf(...parts: string[]): Promise<string> {
  return readFile(join(original.cwd, ...parts), 'utf8');
}

describe('the column a client key may not read', () => {
  it('is absent from the select every public read uses', async () => {
    const mappers = await sourceOf('src', 'server', 'data', 'supabase', 'mappers.ts');

    const base = mappers.slice(
      mappers.indexOf('export const REVIEW_SELECT = `'),
      mappers.indexOf('export const REVIEW_SELECT_WITH_AUTHOR'),
    );

    expect(base).not.toContain('author_id');
  });

  it('is granted back to nobody in the migration', async () => {
    // The first version of this fix was `revoke select (author_id) ...`, which
    // does nothing at all while a table-level SELECT grant stands. It was
    // applied, changed nothing, and was caught only by re-running the attack.
    // What replaced it revokes the table grant and lists the columns instead —
    // so the list itself is now the control, and this is what watches it.
    const migration = await sourceOf('supabase', 'migrations', '0040_author_pseudonym.sql');

    expect(migration).toContain('revoke select on table reviews from anon, authenticated;');

    const grant = migration.slice(
      migration.indexOf('grant select ('),
      migration.indexOf('on table reviews to anon, authenticated;'),
    );

    expect(grant).not.toContain('author_id');
    // Every other column of the table, so a public page still renders.
    for (const column of [
      'id',
      'property_id',
      'residency_status',
      'moved_in_month',
      'overall_rating',
      'body',
      'verification_level',
      'status',
      'helpful_count',
      'created_at',
    ]) {
      expect(grant, `${column} is not granted back`).toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it('is read through the service role wherever the server genuinely needs it', async () => {
    const adapter = await sourceOf('src', 'server', 'data', 'supabase', 'index.ts');

    for (const method of ['getReviewById', 'listReviewsByAuthor', 'hasExistingReview']) {
      const start = adapter.indexOf(`async ${method}(`);
      expect(start, `${method} not found`).toBeGreaterThan(-1);

      const body = adapter.slice(start, start + 700);
      expect(body, `${method} still reads reviews through a client key`).toContain('this.admin()');
    }
  });
});

describe('what a reader is given', () => {
  it('carries no author identifier of any kind', async () => {
    const { LocalRepository } = await import('@/server/data/local');
    const { mutate } = await import('@/server/data/local/store');
    const repository = new LocalRepository();

    const author = await repository.upsertUser({ email: 'the.author@example.test' });
    await mutate((database) => {
      const user = database.users.find((u) => u.id === author.id);
      if (user) user.role = 'resident';
    });

    const property = await repository.createProperty(
      {
        buildingName: 'Ashfield Court',
        streetAddress: '61 Example Street',
        neighbourhood: null,
        locality: 'London',
        adminArea: null,
        postalCode: null,
        countryCode: 'GB',
        propertyType: 'apartment',
        coordinates: { latitude: 51.546, longitude: -0.052 },
      },
      author.id,
    );

    await repository.createReview(
      {
        propertyId: property.id,
        residencyStatus: 'former',
        movedInMonth: '2021-01-01',
        movedOutMonth: '2023-01-01',
        overallRating: 2,
        categoryRatings: [{ categoryKey: 'management', rating: 2 }],
        positiveTags: [],
        problemTags: ['slow_repairs'],
        primaryDepartureReason: 'maintenance',
        secondaryDepartureReasons: [],
        noticedManagementChange: null,
        body: 'The boiler was broken for a whole winter.',
        wouldRecommend: false,
        rentAmountMinor: null,
        rentCurrency: null,
        rentPeriod: null,
        status: 'published',
        safetyFlags: [],
        verificationId: null,
      },
      author.id,
    );

    const page = await repository.listPublicReviews(property.id);
    const serialised = JSON.stringify(page.items);

    expect(page.items).toHaveLength(1);
    expect(serialised).not.toContain(author.id);
    expect(serialised).not.toContain('authorId');
    expect(serialised).not.toContain('author_id');
  });

  it('cannot be used to group one person across buildings', async () => {
    // The actual attack: one author, two buildings, and nothing in what a
    // reader receives that says the two reviews belong together.
    const { LocalRepository } = await import('@/server/data/local');
    const { mutate } = await import('@/server/data/local/store');
    const repository = new LocalRepository();

    const author = await repository.upsertUser({ email: 'the.author@example.test' });
    await mutate((database) => {
      const user = database.users.find((u) => u.id === author.id);
      if (user) user.role = 'resident';
    });

    const draft = (propertyId: string) => ({
      propertyId,
      residencyStatus: 'former' as const,
      movedInMonth: '2021-01-01',
      movedOutMonth: '2023-01-01',
      overallRating: 2,
      categoryRatings: [{ categoryKey: 'management', rating: 2 }],
      positiveTags: [],
      problemTags: ['slow_repairs'],
      primaryDepartureReason: 'maintenance',
      secondaryDepartureReasons: [],
      noticedManagementChange: null,
      body: 'Repairs took months.',
      wouldRecommend: false,
      rentAmountMinor: null,
      rentCurrency: null,
      rentPeriod: null,
      status: 'published' as const,
      safetyFlags: [],
      verificationId: null,
    });

    const ids: string[] = [];
    for (const name of ['Ashfield Court', 'Brookwood House']) {
      const property = await repository.createProperty(
        {
          buildingName: name,
          streetAddress: `${ids.length + 1} Example Street`,
          neighbourhood: null,
          locality: 'London',
          adminArea: null,
          postalCode: null,
          countryCode: 'GB',
          propertyType: 'apartment',
          coordinates: null,
        },
        author.id,
      );
      await repository.createReview(draft(property.id), author.id);
      ids.push(property.id);
    }

    // A third review, same everything, different person. If any field lets a
    // reader tell "these two share an author" apart from "these two do not",
    // that field is a correlation key whatever it is called.
    const stranger = await repository.upsertUser({ email: 'somebody.else@example.test' });
    await mutate((database) => {
      const user = database.users.find((u) => u.id === stranger.id);
      if (user) user.role = 'resident';
    });

    const third = await repository.createProperty(
      {
        buildingName: 'Cedar Mansions',
        streetAddress: '3 Example Street',
        neighbourhood: null,
        locality: 'London',
        adminArea: null,
        postalCode: null,
        countryCode: 'GB',
        propertyType: 'apartment',
        coordinates: null,
      },
      stranger.id,
    );
    await repository.createReview(draft(third.id), stranger.id);

    const [mineA] = (await repository.listPublicReviews(ids[0]!)).items;
    const [mineB] = (await repository.listPublicReviews(ids[1]!)).items;
    const [theirs] = (await repository.listPublicReviews(third.id)).items;

    /**
     * Fields that identify the *review* rather than its author.
     *
     * Excluded from the comparison because they vary between any two reviews
     * for reasons that have nothing to do with who wrote them — and because
     * leaving them in made this test depend on the clock. Three reviews
     * written in immediate succession may or may not share a millisecond, so
     * `createdAt` differed in one comparison and not the other purely by
     * timing, and the assertion failed about one run in six with no defect
     * present.
     */
    const PER_REVIEW = new Set(['id', 'propertyId', 'createdAt']);

    const differing = (
      left: Record<string, unknown>,
      right: Record<string, unknown>,
    ): string[] => {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      return [...keys]
        .filter((key) => !PER_REVIEW.has(key))
        .filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]))
        .sort();
    };

    const sameAuthor = differing(
      mineA as unknown as Record<string, unknown>,
      mineB as unknown as Record<string, unknown>,
    );
    const differentAuthor = differing(
      mineA as unknown as Record<string, unknown>,
      theirs as unknown as Record<string, unknown>,
    );

    // Nothing may differ in only one of the two comparisons, because that is
    // precisely a field that encodes authorship.
    expect(sameAuthor).toEqual(differentAuthor);

    // The sharper form, and the one that would actually catch a pseudonym:
    // these three reviews are identical drafts, so once the per-review
    // identifiers are set aside nothing should differ at all. A field derived
    // from the author would show up here as a difference between two authors
    // and not between two reviews by one.
    expect(differentAuthor).toEqual([]);
  });
});

describe('reporting your own review', () => {
  it('is refused by the database, not only by the form', async () => {
    // It lived in a Server Action until Phase 13, and PostgREST does not run
    // Server Actions — the same shape of hole as the role column before 0020.
    const migration = await sourceOf('supabase', 'migrations', '0040_author_pseudonym.sql');

    expect(migration).toContain('review_reports_no_self_report');
    expect(migration).toContain('You cannot report your own review');
    // A trigger rather than a policy: it reads another table, and it binds the
    // service role too.
    expect(migration).toMatch(/create trigger review_reports_no_self_report\s+before insert/);
  });
});
