import { describe, expect, it } from 'vitest';

import { toPublicReview } from '@/server/data/public-review';
import { makeReview, NOW } from '../fixtures';

/**
 * What actually leaves the server.
 *
 * The instruction these tests answer is "inspect API responses rather than
 * assuming RLS is sufficient". RLS decides which rows a role may read; it says
 * nothing about which *columns* of a row an application then serialises into a
 * page. `toPublicReview` is the only place a stored review becomes a public
 * one, so it is the place to assert the boundary — and it is asserted by
 * enumerating the keys rather than by checking a handful, so a field added to
 * `Review` in a year's time fails this test rather than shipping.
 */

const PUBLIC_KEYS = [
  'id',
  'propertyId',
  'residencyStatus',
  'verificationLevel',
  'recency',
  'attribution',
  'trustLabel',
  'tenureLabel',
  'tenureMonths',
  'overallRating',
  'body',
  'wouldRecommend',
  'categoryRatings',
  'positiveTags',
  'problemTags',
  'primaryDepartureReason',
  'rent',
  'rentPeriod',
  'helpfulCount',
  'isDemo',
  'createdAt',
  'ownerResponse',
].sort();

const verifiedReview = makeReview({
  authorId: 'author-under-test',
  verificationLevel: 'location_verified',
  verificationId: 'verify-abc123',
  verifiedAt: '2026-09-08T16:13:44.000Z',
  residencyStatus: 'current',
  movedOutMonth: null,
  createdAt: '2026-09-08T16:20:00.000Z',
});

describe('a public review carries nothing that identifies or locates anyone', () => {
  it('exposes exactly the agreed fields and no others', () => {
    expect(Object.keys(toPublicReview(verifiedReview, null, NOW)).sort()).toEqual(PUBLIC_KEYS);
  });

  it('does not carry the author', () => {
    const serialised = JSON.stringify(toPublicReview(verifiedReview, null, NOW));
    expect(serialised).not.toContain('author-under-test');
    expect(serialised).not.toContain('authorId');
  });

  it('does not carry the verification record or when it happened', () => {
    const publicReview = toPublicReview(verifiedReview, null, NOW);
    const serialised = JSON.stringify(publicReview);

    // The record id would let a reader correlate two reviews to one session.
    expect(serialised).not.toContain('verify-abc123');
    expect(serialised).not.toContain('verificationId');
    // The exact minute would place a person at an address at a moment.
    expect(serialised).not.toContain('16:13:44');
    expect(serialised).not.toContain('verifiedAt');
    expect(publicReview).not.toHaveProperty('verifiedAt');
  });

  it('carries no coordinate, accuracy, distance, device or address detail', () => {
    const serialised = JSON.stringify(toPublicReview(verifiedReview, null, NOW));

    for (const forbidden of [
      'latitude',
      'longitude',
      'coordinates',
      'accuracy',
      'distance',
      'ipAddress',
      'userAgent',
      'unit',
    ]) {
      expect(serialised.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('does not carry the exact tenancy month of a departure in its labels', () => {
    // The stored month is real data the aggregates need; the *label* a reader
    // sees is year precision, so a tenancy cannot be matched against a letting
    // record.
    const review = makeReview({
      residencyStatus: 'former',
      movedInMonth: '2023-03-01',
      movedOutMonth: '2025-07-01',
    });
    expect(toPublicReview(review, null, NOW).tenureLabel).toContain('2025');
    expect(toPublicReview(review, null, NOW).tenureLabel).not.toContain('July');
    expect(toPublicReview(review, null, NOW).tenureLabel).not.toContain('07');
  });
});

describe('the trust line says what was established and no more', () => {
  it('never claims a location-verified reviewer lives there', () => {
    const publicReview = toPublicReview(verifiedReview, null, NOW);

    expect(publicReview.attribution.toLowerCase()).toContain('location verified');
    // The distinction the whole feature rests on: presence is not tenancy.
    expect(publicReview.attribution.toLowerCase()).not.toContain('verified resident');
    expect(publicReview.attribution.toLowerCase()).not.toContain('verified current');
  });

  it('reserves "verified resident" for a document a moderator read', () => {
    const review = makeReview({
      verificationLevel: 'verified_resident',
      residencyStatus: 'former',
      movedOutMonth: '2026-05-01',
    });
    expect(toPublicReview(review, null, NOW).attribution).toBe('Verified former resident');
  });

  it('never labels a legacy review as verified', () => {
    // The migration case. A review written before any of this existed keeps
    // saying exactly what it always said.
    const legacy = makeReview({
      verificationLevel: 'unverified',
      verificationId: null,
      verifiedAt: null,
      residencyStatus: 'former',
      movedOutMonth: '2021-06-01',
    });

    const publicReview = toPublicReview(legacy, null, NOW);

    expect(publicReview.attribution).toBe('Former resident');
    expect(publicReview.attribution.toLowerCase()).not.toContain('verif');
    expect(publicReview.trustLabel.toLowerCase()).not.toContain('verif');
  });

  it('states recency and verification in words, not only in a badge', () => {
    // Nothing in the interface may depend on a colour or an icon to be
    // understood, so the label has to carry both facts as text.
    expect(toPublicReview(verifiedReview, null, NOW).trustLabel).toBe(
      'Current resident · Location verified',
    );
  });

  it('describes a stale "current resident" claim by its age, not its tick-box', () => {
    const stale = makeReview({
      residencyStatus: 'current',
      movedOutMonth: null,
      verificationLevel: 'verified_resident',
      createdAt: '2023-01-01T00:00:00.000Z',
    });
    expect(toPublicReview(stale, null, NOW).trustLabel).toBe(
      'Earlier resident · Residency verified',
    );
  });
});
