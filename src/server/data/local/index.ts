import 'server-only';

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { LIMITS, showDemoData } from '@/config/site';
import { buildPropertyIntelligence, emptyIntelligence } from '@/lib/intelligence';
import { matchScore, normaliseForSearch } from '@/lib/search/matching';
import { formatAddressInline, propertyContextLine, propertyDisplayName } from '@/lib/format';
import { propertySlug, shortId } from '@/lib/utils';
import type {
  AdminUserDetail,
  AdminUserFilters,
  AdminUserPage,
  AdminUserReport,
  AdminUserReview,
  ClaimStatus,
  ModerationAction,
  Property,
  PropertyClaim,
  PropertyIntelligence,
  PropertySummary,
  ReportStatus,
  Review,
  ReviewReport,
  ReviewStatus,
  SavedProperty,
  SearchFilters,
  SearchResults,
  SearchSuggestion,
  UserProfile,
  PropertyFlag,
  PropertyFlagStatus,
  PropertyVerification,
  PropertyVerificationFailureReason,
  VerificationStanding,
  VerificationCheck,
  VerificationLevel,
  VerificationMethod,
  VerificationOutcome,
  VerificationRecord,
} from '@/types/domain';
import { detectPropertyFlags } from '@/lib/safety/burst-detection';
import { maskEmail } from '@/lib/safety/identity';
import type { AdminAuditEntry } from '@/server/admin/audit';
import { VERIFICATION_LIFETIME } from '@/config/verification';
import { haversineMeters, isValidCoordinates } from '@/lib/geo/distance';
import { decideProximity, isImplausibleMovement } from '@/lib/geo/proximity';

/** Matches `p_cooldown_days` in `livd_detect_property_flags`. */
const FLAG_DECISION_COOLDOWN_DAYS = 7;
import type {
  AdminAuditPage,
  AdminOverview,
  IdentityAccessReason,
  IdentityAccessRecord,
  IdentityReveal,
  CreatePropertyInput,
  CreateReviewInput,
  DiscoveryOptions,
  LivdRepository,
  AccountDeletionSummary,
  LocalitySummary,
  NearbyProperty,
  ReviewListOptions,
  ReviewListResult,
} from '../repository';
import { toPublicReview } from '../public-review';
import { getDatabase, mutate, type LocalDatabase, type StoredVerification } from './store';

/**
 * File-backed repository.
 *
 * Implements the full `LivdRepository` contract — including moderation, claims
 * and the audit trail — so every flow in the product works end to end without
 * an external service. The Supabase adapter is held to the same contract tests.
 */

function nowIso(): string {
  return new Date().toISOString();
}

function visibleProperties(database: LocalDatabase): Property[] {
  const demoAllowed = showDemoData();
  return database.properties.filter(
    (property) => property.status === 'active' && (demoAllowed || !property.isDemo),
  );
}

function publishedReviewsFor(database: LocalDatabase, propertyId: string): Review[] {
  const demoAllowed = showDemoData();
  return database.reviews.filter(
    (review) =>
      review.propertyId === propertyId &&
      review.status === 'published' &&
      (demoAllowed || !review.isDemo),
  );
}

function intelligenceFor(database: LocalDatabase, propertyId: string): PropertyIntelligence {
  const reviews = publishedReviewsFor(database, propertyId);
  if (reviews.length === 0) return emptyIntelligence(propertyId);
  return buildPropertyIntelligence(propertyId, reviews);
}

function summaryFor(database: LocalDatabase, property: Property): PropertySummary {
  return { property, intelligence: intelligenceFor(database, property.id) };
}

/** Everything a property can be found by, in one string. */
function haystackFor(property: Property): string {
  const { address } = property;
  return [
    address.buildingName,
    address.streetAddress,
    address.neighbourhood,
    address.locality,
    address.adminArea,
    address.postalCode,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Normalised address identity, used to detect that two submissions describe the
 * same real-world property.
 */
function addressKey(input: {
  countryCode: string;
  locality: string;
  streetAddress: string | null;
  buildingName: string | null;
}): string {
  return [
    input.countryCode.toUpperCase(),
    normaliseForSearch(input.locality),
    normaliseForSearch(input.streetAddress ?? ''),
    normaliseForSearch(input.buildingName ?? ''),
  ].join('|');
}


/**
 * Everything the directory and the detail view count about one account.
 *
 * Postgres has `livd_admin_user_counts`, shared by both callers for the same
 * reason: a list saying four reviews beside a page saying three is a bug
 * somebody chases for an afternoon.
 */
/**
 * The reasons an identity may be accessed for.
 *
 * A table in Postgres (`identity_access_reasons`, migration 0025) so the
 * vocabulary is a data change rather than a deploy. Here it is a constant,
 * kept identical — `tests/safety/identity-reveal.test.ts` is what holds the
 * two together.
 */
const IDENTITY_ACCESS_REASONS: IdentityAccessReason[] = [
  {
    key: 'safety_investigation',
    label: 'Safety investigation',
    description: "A credible concern about somebody's physical safety.",
    requiresDetail: false,
  },
  {
    key: 'fraud_investigation',
    label: 'Fraud investigation',
    description: 'Suspected review manipulation, coordinated activity or impersonation.',
    requiresDetail: false,
  },
  {
    key: 'serious_abuse',
    label: 'Serious abuse or harassment',
    description: 'Targeted harassment, threats, or a sustained campaign against a person.',
    requiresDetail: false,
  },
  {
    key: 'legal_request',
    label: 'Legal request',
    description: 'A request with an apparent legal basis, recorded as an authority request.',
    requiresDetail: true,
  },
  {
    key: 'regulatory_request',
    label: 'Regulatory request',
    description: 'A request from a body with regulatory authority over Livd.',
    requiresDetail: true,
  },
  {
    key: 'security_investigation',
    label: 'Security investigation',
    description: 'Account compromise, platform abuse or an incident affecting Livd itself.',
    requiresDetail: false,
  },
  {
    key: 'other',
    label: 'Other Trust & Safety reason',
    description: 'Anything else. Say what it is — this one is read.',
    requiresDetail: true,
  },
];

function countsFor(database: LocalDatabase, userId: string) {
  const authored = database.reviews.filter((review) => review.authorId === userId);
  const authoredIds = new Set(authored.map((review) => review.id));

  return {
    reviewCount: authored.length,
    publishedReviewCount: authored.filter((r) => r.status === 'published').length,
    removedReviewCount: authored.filter((r) => r.status === 'removed').length,
    heldReviewCount: authored.filter(
      (r) => r.status === 'held' || r.status === 'pending_moderation',
    ).length,
    verifiedReviewCount: authored.filter(
      (r) =>
        r.verificationLevel === 'location_verified' ||
        r.verificationLevel === 'verified_resident',
    ).length,
    reportsAgainst: database.reports.filter((report) => authoredIds.has(report.reviewId)).length,
    reportsMade: database.reports.filter((report) => report.reporterId === userId).length,
    locationCheckCount: database.propertyVerifications.filter((v) => v.userId === userId).length,
    residencySubmissions: database.verifications.filter((v) => v.submittedBy === userId).length,
    lastReviewAt:
      authored.length === 0
        ? null
        : authored.reduce(
            (latest, review) => (review.createdAt > latest ? review.createdAt : latest),
            authored[0]!.createdAt,
          ),
  };
}

export class LocalRepository implements LivdRepository {
  /* ---------------------------------------------------------------------
   * Properties
   * ------------------------------------------------------------------ */

  async getPropertyBySlug(slug: string): Promise<Property | null> {
    const database = await getDatabase();
    return visibleProperties(database).find((property) => property.slug === slug) ?? null;
  }

  async getPropertyById(id: string): Promise<Property | null> {
    const database = await getDatabase();
    return visibleProperties(database).find((property) => property.id === id) ?? null;
  }

  async getPropertySummary(propertyId: string): Promise<PropertySummary | null> {
    const database = await getDatabase();
    const property = visibleProperties(database).find((p) => p.id === propertyId);
    return property ? summaryFor(database, property) : null;
  }

  async getPropertyIntelligence(propertyId: string): Promise<PropertyIntelligence> {
    const database = await getDatabase();
    return intelligenceFor(database, propertyId);
  }

  async createProperty(input: CreatePropertyInput, createdBy: string): Promise<Property> {
    return mutate((database) => {
      const timestamp = nowIso();
      const existingSlugs = new Set(database.properties.map((p) => p.slug));

      let slug = propertySlug({
        buildingName: input.buildingName,
        streetAddress: input.streetAddress,
        locality: input.locality,
      });
      if (existingSlugs.has(slug)) {
        slug = propertySlug({
          buildingName: input.buildingName,
          streetAddress: input.streetAddress,
          locality: input.locality,
          discriminator: shortId(5),
        });
      }

      const property: Property = {
        id: `prop-${shortId(12)}`,
        slug,
        address: {
          buildingName: input.buildingName,
          streetAddress: input.streetAddress,
          neighbourhood: input.neighbourhood,
          locality: input.locality,
          adminArea: input.adminArea,
          postalCode: input.postalCode,
          countryCode: input.countryCode.toUpperCase(),
        },
        propertyType: input.propertyType,
        // Rounded here as well as by the database trigger, so the two adapters
        // store the same thing and a coordinate is never unit-precise in
        // either. Three decimal places is about 110m.
        coordinates: input.coordinates
          ? {
              latitude: Math.round(input.coordinates.latitude * 1000) / 1000,
              longitude: Math.round(input.coordinates.longitude * 1000) / 1000,
            }
          : null,
        unitCount: null,
        yearBuilt: null,
        status: 'active',
        mergedInto: null,
        isDemo: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      database.properties.push(property);
      void createdBy;
      return property;
    });
  }

  async findDuplicateProperty(input: CreatePropertyInput): Promise<Property | null> {
    const database = await getDatabase();
    const key = addressKey(input);
    return (
      visibleProperties(database).find(
        (property) =>
          addressKey({
            countryCode: property.address.countryCode,
            locality: property.address.locality,
            streetAddress: property.address.streetAddress,
            buildingName: property.address.buildingName,
          }) === key,
      ) ?? null
    );
  }

  /* ---------------------------------------------------------------------
   * Search & discovery
   * ------------------------------------------------------------------ */

  async searchProperties(filters: SearchFilters): Promise<SearchResults> {
    const database = await getDatabase();
    const pageSize = LIMITS.searchPageSize;

    let candidates = visibleProperties(database);

    if (filters.countryCode) {
      candidates = candidates.filter(
        (p) => p.address.countryCode === filters.countryCode!.toUpperCase(),
      );
    }
    if (filters.locality) {
      const locality = normaliseForSearch(filters.locality);
      candidates = candidates.filter((p) => normaliseForSearch(p.address.locality) === locality);
    }
    if (filters.propertyTypes.length > 0) {
      candidates = candidates.filter((p) => filters.propertyTypes.includes(p.propertyType));
    }

    // Score against the query, when there is one.
    let scored: Array<{ property: Property; score: number; fuzzy: boolean }>;
    let anyFuzzy = false;

    if (filters.query.trim().length > 0) {
      scored = [];
      for (const property of candidates) {
        const result = matchScore(filters.query, { haystack: haystackFor(property) });
        if (!result) continue;
        if (result.fuzzy) anyFuzzy = true;
        scored.push({ property, score: result.score, fuzzy: result.fuzzy });
      }
    } else {
      scored = candidates.map((property) => ({ property, score: 0, fuzzy: false }));
    }

    // Attach intelligence, then apply score-dependent filters.
    let summaries: PropertySummary[] = scored.map(({ property }) =>
      summaryFor(database, property),
    );
    const scoreByProperty = new Map(scored.map((s) => [s.property.id, s.score]));

    if (filters.minScore !== null) {
      summaries = summaries.filter(
        (s) => s.intelligence.overallScore !== null && s.intelligence.overallScore >= filters.minScore!,
      );
    }
    if (filters.minReviews !== null) {
      summaries = summaries.filter((s) => s.intelligence.reviewCount >= filters.minReviews!);
    }
    if (filters.verifiedOnly) {
      summaries = summaries.filter((s) => s.intelligence.verifiedReviewCount > 0);
    }

    summaries.sort((a, b) => compareForSort(a, b, filters.sort, scoreByProperty));

    const total = summaries.length;
    const page = Math.max(1, filters.page);
    const start = (page - 1) * pageSize;

    // Only claim a correction when fuzzy matching was the only thing that found
    // anything — otherwise the notice would appear on perfectly good results.
    const correctedFrom =
      anyFuzzy && scored.every((s) => s.fuzzy) && total > 0 ? filters.query : null;

    return {
      items: summaries.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      correctedFrom,
    };
  }

  async suggest(query: string, limit: number): Promise<SearchSuggestion[]> {
    const database = await getDatabase();
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const properties = visibleProperties(database);
    const suggestions: Array<SearchSuggestion & { score: number }> = [];

    for (const property of properties) {
      const result = matchScore(trimmed, { haystack: haystackFor(property) });
      if (!result) continue;

      const intelligence = intelligenceFor(database, property.id);
      suggestions.push({
        kind: 'property',
        label: propertyDisplayName(property.address),
        sublabel: propertyContextLine(property.address),
        href: `/property/${property.slug}`,
        reviewCount: intelligence.reviewCount,
        score: result.score,
      });
    }

    // Localities and neighbourhoods, so "Lekki" leads somewhere useful even
    // when no single property matches the spelling.
    const places = new Map<string, { label: string; sublabel: string; href: string; count: number }>();
    for (const property of properties) {
      const { locality, adminArea, countryCode, neighbourhood } = property.address;

      const localityKey = `${countryCode}:${locality}`;
      const existingLocality = places.get(localityKey);
      places.set(localityKey, {
        label: locality,
        sublabel: [adminArea, countryCode].filter(Boolean).join(', '),
        href: `/places/${countryCode.toLowerCase()}/${encodeURIComponent(locality.toLowerCase())}`,
        count: (existingLocality?.count ?? 0) + 1,
      });

      if (neighbourhood) {
        const neighbourhoodKey = `${countryCode}:${locality}:${neighbourhood}`;
        const existing = places.get(neighbourhoodKey);
        places.set(neighbourhoodKey, {
          label: neighbourhood,
          sublabel: [locality, adminArea].filter(Boolean).join(', '),
          href: `/search?q=${encodeURIComponent(neighbourhood)}`,
          count: (existing?.count ?? 0) + 1,
        });
      }
    }

    for (const [key, place] of places) {
      const result = matchScore(trimmed, { haystack: place.label });
      if (!result) continue;
      suggestions.push({
        kind: key.split(':').length > 2 ? 'neighbourhood' : 'locality',
        label: place.label,
        sublabel: place.sublabel,
        href: place.href,
        reviewCount: null,
        // Places rank slightly below an equally-matching property, because a
        // searcher with a specific address in mind should see it first.
        score: result.score - 3,
      });
    }

    return suggestions
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
      .slice(0, limit)
      .map(({ score: _score, ...suggestion }) => suggestion);
  }

  async recentlyReviewed(options: DiscoveryOptions = {}): Promise<PropertySummary[]> {
    const database = await getDatabase();
    return this.discover(database, options, (a, b) =>
      (b.intelligence.lastReviewAt ?? '').localeCompare(a.intelligence.lastReviewAt ?? ''),
    );
  }

  async mostReviewed(options: DiscoveryOptions = {}): Promise<PropertySummary[]> {
    const database = await getDatabase();
    return this.discover(
      database,
      options,
      (a, b) => b.intelligence.reviewCount - a.intelligence.reviewCount,
    );
  }

  async highestRated(options: DiscoveryOptions = {}): Promise<PropertySummary[]> {
    const database = await getDatabase();
    return this.discover(
      database,
      options,
      (a, b) => (b.intelligence.overallScore ?? 0) - (a.intelligence.overallScore ?? 0),
      // Moderate evidence at minimum. A "highest rated" list headed by
      // three-review properties is misleading however honestly the confidence
      // is labelled beside it — the list itself is the claim.
      (summary) =>
        summary.intelligence.confidence === 'moderate' ||
        summary.intelligence.confidence === 'strong',
    );
  }

  private discover(
    database: LocalDatabase,
    options: DiscoveryOptions,
    compare: (a: PropertySummary, b: PropertySummary) => number,
    filter: (summary: PropertySummary) => boolean = (s) => s.intelligence.reviewCount > 0,
  ): PropertySummary[] {
    let properties = visibleProperties(database);
    if (options.countryCode) {
      properties = properties.filter(
        (p) => p.address.countryCode === options.countryCode!.toUpperCase(),
      );
    }

    return properties
      .map((property) => summaryFor(database, property))
      .filter(filter)
      .sort(compare)
      .slice(0, options.limit ?? 6);
  }

  async listLocalities(countryCode?: string | null): Promise<LocalitySummary[]> {
    const database = await getDatabase();
    const properties = visibleProperties(database).filter(
      (p) => !countryCode || p.address.countryCode === countryCode.toUpperCase(),
    );

    const localities = new Map<string, LocalitySummary>();

    for (const property of properties) {
      const key = `${property.address.countryCode}:${property.address.locality}`;
      const reviewCount = publishedReviewsFor(database, property.id).length;
      const existing = localities.get(key);

      if (existing) {
        existing.propertyCount += 1;
        existing.reviewCount += reviewCount;
      } else {
        localities.set(key, {
          countryCode: property.address.countryCode,
          locality: property.address.locality,
          adminArea: property.address.adminArea,
          propertyCount: 1,
          reviewCount,
          href: `/places/${property.address.countryCode.toLowerCase()}/${encodeURIComponent(
            property.address.locality.toLowerCase(),
          )}`,
        });
      }
    }

    return [...localities.values()].sort(
      (a, b) => b.reviewCount - a.reviewCount || a.locality.localeCompare(b.locality),
    );
  }

  async propertiesInLocality(countryCode: string, locality: string): Promise<PropertySummary[]> {
    const database = await getDatabase();
    const target = normaliseForSearch(locality);

    return visibleProperties(database)
      .filter(
        (p) =>
          p.address.countryCode === countryCode.toUpperCase() &&
          normaliseForSearch(p.address.locality) === target,
      )
      .map((property) => summaryFor(database, property))
      .sort((a, b) => b.intelligence.reviewCount - a.intelligence.reviewCount);
  }

  /* ---------------------------------------------------------------------
   * Reviews
   * ------------------------------------------------------------------ */

  async listPublicReviews(
    propertyId: string,
    options: ReviewListOptions = {},
  ): Promise<ReviewListResult> {
    const database = await getDatabase();
    const pageSize = options.pageSize ?? LIMITS.reviewsPerPage;
    const page = Math.max(1, options.page ?? 1);

    let reviews = publishedReviewsFor(database, propertyId);

    if (options.residency && options.residency !== 'all') {
      reviews = reviews.filter((review) => review.residencyStatus === options.residency);
    }
    if (options.verifiedOnly) {
      // "Verified" in the interface means any level of verification. A filter
      // labelled verified that silently excluded location-verified reviews
      // would be a lie in the UI rather than a subtlety in the store.
      reviews = reviews.filter(
        (review) =>
          review.verificationLevel === 'verified_resident' ||
          review.verificationLevel === 'location_verified',
      );
    }

    switch (options.sort ?? 'recent') {
      case 'helpful':
        reviews.sort((a, b) => b.helpfulCount - a.helpfulCount || b.createdAt.localeCompare(a.createdAt));
        break;
      case 'highest':
        reviews.sort((a, b) => b.overallRating - a.overallRating || b.createdAt.localeCompare(a.createdAt));
        break;
      case 'lowest':
        reviews.sort((a, b) => a.overallRating - b.overallRating || b.createdAt.localeCompare(a.createdAt));
        break;
      default:
        reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    const responsesByReview = new Map(
      database.ownerResponses.map((response) => [response.reviewId, response]),
    );

    const start = (page - 1) * pageSize;

    return {
      items: reviews
        .slice(start, start + pageSize)
        .map((review) => toPublicReview(review, responsesByReview.get(review.id) ?? null)),
      total: reviews.length,
      page,
      pageSize,
    };
  }

  async getReviewById(id: string): Promise<Review | null> {
    const database = await getDatabase();
    return database.reviews.find((review) => review.id === id) ?? null;
  }

  async listReviewsByAuthor(authorId: string): Promise<Review[]> {
    const database = await getDatabase();
    return database.reviews
      .filter((review) => review.authorId === authorId && review.status !== 'removed')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createReview(input: CreateReviewInput, authorId: string): Promise<Review> {
    return mutate((database) => {
      const timestamp = nowIso();
      const tenureMonths = computeTenure(input.movedInMonth, input.movedOutMonth);

      const review: Review = {
        id: `review-${shortId(12)}`,
        propertyId: input.propertyId,
        authorId,
        residencyStatus: input.residencyStatus,
        movedInMonth: input.movedInMonth,
        movedOutMonth: input.movedOutMonth,
        tenureMonths,
        overallRating: input.overallRating,
        body: input.body,
        wouldRecommend: input.wouldRecommend,
        rent:
          input.rentAmountMinor !== null && input.rentCurrency
            ? { amountMinor: input.rentAmountMinor, currencyCode: input.rentCurrency }
            : null,
        rentPeriod: input.rentPeriod,
        categoryRatings: input.categoryRatings,
        positiveTags: input.positiveTags,
        problemTags: input.problemTags,
        primaryDepartureReason: input.primaryDepartureReason,
        secondaryDepartureReasons: input.secondaryDepartureReasons,
        noticedManagementChange: input.noticedManagementChange,
        ...deriveReviewVerification(database, input, authorId),
        status: input.status,
        safetyFlags: input.safetyFlags,
        helpfulCount: 0,
        isDemo: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      database.reviews.push(review);
      return review;
    });
  }

  async updateReview(
    id: string,
    authorId: string,
    patch: Partial<Pick<CreateReviewInput, 'body' | 'wouldRecommend'>>,
  ): Promise<Review> {
    return mutate((database) => {
      const review = database.reviews.find((r) => r.id === id);
      if (!review) throw new Error('Review not found');
      if (review.authorId !== authorId) throw new Error('Not the author of this review');

      const ageHours = (Date.now() - new Date(review.createdAt).getTime()) / 3_600_000;
      if (ageHours > LIMITS.reviewEditWindowHours) {
        throw new Error('The edit window for this review has closed');
      }

      if (patch.body !== undefined) review.body = patch.body;
      if (patch.wouldRecommend !== undefined) review.wouldRecommend = patch.wouldRecommend;
      review.updatedAt = nowIso();

      return review;
    });
  }

  async hasExistingReview(
    propertyId: string,
    authorId: string,
    movedInMonth: string,
  ): Promise<boolean> {
    const database = await getDatabase();
    const tenancyYear = movedInMonth.slice(0, 4);

    return database.reviews.some(
      (review) =>
        review.propertyId === propertyId &&
        review.authorId === authorId &&
        review.status !== 'removed' &&
        review.movedInMonth.slice(0, 4) === tenancyYear,
    );
  }

  async markReviewHelpful(reviewId: string, userId: string): Promise<number> {
    return mutate((database) => {
      const review = database.reviews.find((r) => r.id === reviewId);
      if (!review) throw new Error('Review not found');

      const existing = database.helpfulVotes.find(
        (vote) => vote.reviewId === reviewId && vote.voterId === userId,
      );

      if (existing) {
        database.helpfulVotes = database.helpfulVotes.filter(
          (vote) => !(vote.reviewId === reviewId && vote.voterId === userId),
        );
        review.helpfulCount = Math.max(0, review.helpfulCount - 1);
      } else {
        database.helpfulVotes.push({ reviewId, voterId: userId });
        review.helpfulCount += 1;
      }

      return review.helpfulCount;
    });
  }

  /* ---------------------------------------------------------------------
   * Moderation
   * ------------------------------------------------------------------ */

  async setReviewStatus(
    reviewId: string,
    status: ReviewStatus,
    actorId: string,
    reason: string,
  ): Promise<void> {
    await mutate((database) => {
      const review = database.reviews.find((r) => r.id === reviewId);
      if (!review) throw new Error('Review not found');

      const previousStatus = review.status;
      review.status = status;
      review.updatedAt = nowIso();

      database.moderationActions.push({
        id: `action-${shortId(12)}`,
        actorId,
        subjectType: 'review',
        subjectId: reviewId,
        action: `set_status:${status}`,
        reason,
        previousStatus,
        newStatus: status,
        createdAt: nowIso(),
      });
    });
  }

  async setReviewVerification(
    reviewId: string,
    level: VerificationLevel,
    actorId: string,
  ): Promise<void> {
    await mutate((database) => {
      const review = database.reviews.find((r) => r.id === reviewId);
      if (!review) throw new Error('Review not found');

      const previous = review.verificationLevel;
      review.verificationLevel = level;
      review.updatedAt = nowIso();

      database.moderationActions.push({
        id: `action-${shortId(12)}`,
        actorId,
        subjectType: 'review',
        subjectId: reviewId,
        action: `set_verification:${level}`,
        reason: null,
        previousStatus: previous,
        newStatus: level,
        createdAt: nowIso(),
      });
    });
  }

  async listReviewsByStatus(
    status: ReviewStatus,
    limit = 50,
  ): Promise<Array<{ review: Review; property: Property }>> {
    const database = await getDatabase();
    const propertiesById = new Map(database.properties.map((p) => [p.id, p]));

    return database.reviews
      .filter((review) => review.status === status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit)
      .flatMap((review) => {
        const property = propertiesById.get(review.propertyId);
        return property ? [{ review, property }] : [];
      });
  }

  async createReport(input: {
    reviewId: string;
    reporterId: string;
    reason: ReviewReport['reason'];
    detail: string | null;
  }): Promise<ReviewReport> {
    return mutate((database) => {
      const duplicate = database.reports.find(
        (report) =>
          report.reviewId === input.reviewId && report.reporterId === input.reporterId,
      );
      if (duplicate) return duplicate;

      const report: ReviewReport = {
        id: `report-${shortId(12)}`,
        reviewId: input.reviewId,
        reporterId: input.reporterId,
        reason: input.reason,
        detail: input.detail,
        status: 'open',
        resolution: null,
        createdAt: nowIso(),
        resolvedAt: null,
      };

      database.reports.push(report);
      return report;
    });
  }

  async listReports(
    status?: ReportStatus,
  ): Promise<Array<{ report: ReviewReport; review: Review; property: Property }>> {
    const database = await getDatabase();
    const reviewsById = new Map(database.reviews.map((r) => [r.id, r]));
    const propertiesById = new Map(database.properties.map((p) => [p.id, p]));

    return database.reports
      .filter((report) => !status || report.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .flatMap((report) => {
        const review = reviewsById.get(report.reviewId);
        const property = review ? propertiesById.get(review.propertyId) : undefined;
        return review && property ? [{ report, review, property }] : [];
      });
  }

  async resolveReport(
    reportId: string,
    status: Extract<ReportStatus, 'upheld' | 'dismissed'>,
    actorId: string,
    resolution: string,
  ): Promise<void> {
    await mutate((database) => {
      const report = database.reports.find((r) => r.id === reportId);
      if (!report) throw new Error('Report not found');

      const previousStatus = report.status;
      report.status = status;
      report.resolution = resolution;
      report.resolvedAt = nowIso();

      database.moderationActions.push({
        id: `action-${shortId(12)}`,
        actorId,
        subjectType: 'review',
        subjectId: report.reviewId,
        action: `report_${status}`,
        reason: resolution,
        previousStatus,
        newStatus: status,
        createdAt: nowIso(),
      });
    });
  }

  /* ---------------------------------------------------------------------
   * Property verification (location)
   * ------------------------------------------------------------------ */

  async getVerificationStanding(
    userId: string,
    propertyId: string,
  ): Promise<VerificationStanding> {
    const database = await getDatabase();
    const property = database.properties.find((p) => p.id === propertyId);

    return {
      canVerifyLocation: Boolean(
        property?.coordinates && isValidCoordinates(property.coordinates),
      ),
      activeVerification: liveVerificationFor(database, userId, propertyId),
    };
  }

  async verifyPropertyLocation(input: {
    userId: string;
    propertyId: string;
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    capturedAtMs: number;
  }): Promise<PropertyVerification> {
    const database = await getDatabase();
    const property = database.properties.find((p) => p.id === input.propertyId);
    if (!property) throw new Error('No such property');

    const now = new Date();

    // Same rule the Postgres function applies, from the same module. Neither
    // is a translation of the other: both call `decideProximity`, and
    // migration 0014 mirrors it in SQL because the production decision has to
    // happen somewhere a browser cannot reach.
    const decision = decideProximity({
      propertyCoordinates: property.coordinates,
      countryCode: property.address.countryCode,
      position: {
        latitude: input.latitude,
        longitude: input.longitude,
        accuracyMeters: input.accuracyMeters,
        capturedAtMs: input.capturedAtMs,
      },
      now,
    });

    let reason: PropertyVerificationFailureReason | null = decision.verified
      ? null
      : decision.reason;

    // Could the same person really have been at both? Computed between the two
    // properties' own published coordinates, so it needs no record of where
    // anyone has been and creates none.
    if (reason === null) {
      const previous = database.propertyVerifications
        .filter(
          (v) =>
            v.userId === input.userId &&
            v.status === 'verified' &&
            v.propertyId !== input.propertyId &&
            now.getTime() - new Date(v.createdAt).getTime() < 3_600_000,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

      const previousProperty = previous
        ? database.properties.find((p) => p.id === previous.propertyId)
        : undefined;

      if (
        previous &&
        previousProperty?.coordinates &&
        property.coordinates &&
        isImplausibleMovement({
          previousPropertyCoordinates: previousProperty.coordinates,
          currentPropertyCoordinates: property.coordinates,
          elapsedSeconds: (now.getTime() - new Date(previous.createdAt).getTime()) / 1000,
        })
      ) {
        reason = 'implausible_movement';
      }
    }

    return mutate((db) => {
      const record: PropertyVerification = {
        id: `verify-${shortId(12)}`,
        userId: input.userId,
        propertyId: input.propertyId,
        method: 'location',
        status: reason === null ? 'verified' : 'failed',
        failureReason: reason,
        expiresAt: new Date(
          now.getTime() + VERIFICATION_LIFETIME.attachWindowMinutes * 60_000,
        ).toISOString(),
        createdAt: now.toISOString(),
      };

      db.propertyVerifications.push(record);
      return record;
    });
  }

  async listPropertyVerifications(
    userId: string,
    limit = 20,
  ): Promise<PropertyVerification[]> {
    const database = await getDatabase();
    return database.propertyVerifications
      .filter((v) => v.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async listRecentVerificationAttempts(
    limit = 50,
  ): Promise<Array<{ verification: PropertyVerification; property: Property }>> {
    const database = await getDatabase();
    const propertiesById = new Map(database.properties.map((p) => [p.id, p]));

    return database.propertyVerifications
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .flatMap((verification) => {
        const property = propertiesById.get(verification.propertyId);
        return property ? [{ verification, property }] : [];
      });
  }

  async propertiesNear(input: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
    limit?: number;
  }): Promise<NearbyProperty[]> {
    const database = await getDatabase();
    const origin = { latitude: input.latitude, longitude: input.longitude };
    if (!isValidCoordinates(origin)) return [];

    return visibleProperties(database)
      .flatMap((property) => {
        if (!property.coordinates || !isValidCoordinates(property.coordinates)) return [];
        const distance = haversineMeters(property.coordinates, origin);
        if (distance > input.radiusMeters) return [];
        return [
          {
            summary: summaryFor(database, property),
            // Rounded before it leaves the data layer: a metre-precise
            // distance to a known building is a position.
            distanceMeters: Math.round(distance / 10) * 10,
          },
        ];
      })
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, input.limit ?? 12);
  }

  /* ---------------------------------------------------------------------
   * Residency verification
   * ------------------------------------------------------------------ */

  async gatherVerificationContext(input: {
    reviewId: string;
    submitterId: string;
    evidenceSha256: string;
  }) {
    const database = await getDatabase();

    const review = database.reviews.find((r) => r.id === input.reviewId);
    if (!review || review.authorId !== input.submitterId) return null;

    const property = database.properties.find((p) => p.id === review.propertyId);
    if (!property) return null;

    const submitter = database.users.find((u) => u.id === input.submitterId);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

    return {
      review,
      property,
      submitterCreatedAt: submitter?.createdAt ?? nowIso(),
      submitterOwnsProperty: database.claims.some(
        (claim) =>
          claim.propertyId === review.propertyId &&
          claim.claimantId === input.submitterId &&
          claim.status === 'approved',
      ),
      priorSubmitterIds: database.verifications
        .filter((record) => record.evidenceSha256 === input.evidenceSha256)
        .map((record) => record.submittedBy)
        .filter((id): id is string => Boolean(id)),
      recentSubmissionCount: database.verifications.filter(
        (record) => record.submittedBy === input.submitterId && record.createdAt >= weekAgo,
      ).length,
    };
  }

  async recordVerificationSubmission(input: {
    reviewId: string;
    submitterId: string;
    method: VerificationMethod;
    checks: VerificationCheck[];
    file: { data: Uint8Array; type: string; bytes: number; sha256: string };
  }): Promise<VerificationRecord> {
    const id = `verification-${shortId(12)}`;

    // Beside the store rather than in it: an 8MB document base64-encoded into
    // the JSON would be rewritten on every unrelated mutation.
    const evidenceRef = await writeEvidenceFile(id, input.file.data);

    return mutate((database) => {
      const record: StoredVerification = {
        id,
        subjectType: 'review',
        subjectId: input.reviewId,
        submittedBy: input.submitterId,
        method: input.method,
        outcome: 'pending',
        checks: input.checks,
        evidenceRef,
        evidenceSha256: input.file.sha256,
        evidenceMime: input.file.type,
        evidenceBytes: input.file.bytes,
        notes: null,
        reviewedBy: null,
        decidedAt: null,
        createdAt: nowIso(),
      };

      database.verifications.push(record);
      return toPublicVerification(record);
    });
  }

  async listPendingVerifications() {
    const database = await getDatabase();
    const reviewsById = new Map(database.reviews.map((r) => [r.id, r]));
    const propertiesById = new Map(database.properties.map((p) => [p.id, p]));

    return database.verifications
      .filter((record) => record.outcome === 'pending' && record.subjectType === 'review')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .flatMap((record) => {
        const review = reviewsById.get(record.subjectId);
        const property = review ? propertiesById.get(review.propertyId) : undefined;
        return review && property
          ? [{ record: toPublicVerification(record), review, property }]
          : [];
      });
  }

  async listVerificationsForReview(reviewId: string): Promise<VerificationRecord[]> {
    const database = await getDatabase();
    return database.verifications
      .filter((record) => record.subjectType === 'review' && record.subjectId === reviewId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toPublicVerification);
  }

  async decideVerification(
    recordId: string,
    outcome: Extract<VerificationOutcome, 'approved' | 'rejected'>,
    actorId: string,
    notes: string,
  ): Promise<void> {
    const reviewId = await mutate((database) => {
      const record = database.verifications.find(
        (r) => r.id === recordId && r.outcome === 'pending',
      );
      if (!record) throw new Error('No pending verification request with that id');

      record.outcome = outcome;
      record.reviewedBy = actorId;
      record.notes = notes;
      record.decidedAt = nowIso();

      database.moderationActions.push({
        id: `action-${shortId(12)}`,
        actorId,
        subjectType: 'review',
        subjectId: record.subjectId,
        action: `verification_${outcome}`,
        reason: notes,
        previousStatus: 'pending',
        newStatus: outcome,
        createdAt: nowIso(),
      });

      return record.subjectId;
    });

    if (outcome === 'approved') {
      // Rejection deliberately leaves the level alone. Failing to produce a
      // document is not evidence of having lied.
      await this.setReviewVerification(reviewId, 'verified_resident', actorId);
    }
  }

  async createVerificationEvidenceLink(recordId: string): Promise<string | null> {
    const database = await getDatabase();
    const record = database.verifications.find((r) => r.id === recordId);
    if (!record?.evidenceRef) return null;

    // No object storage here to sign a URL against, so the file is inlined for
    // the moderator's own page render. It never becomes an address anyone else
    // could follow, which is the property that matters.
    return readEvidenceAsDataUrl(record.evidenceRef, record.evidenceMime);
  }

  /* ---------------------------------------------------------------------
   * Automated signals
   * ------------------------------------------------------------------ */

  /**
   * Derives the flags on read.
   *
   * Production runs the same three rules on a schedule inside Postgres and
   * stores what they find. There is no scheduler here, so they are recomputed
   * from the store each time and matched against whatever decisions a
   * moderator has already recorded. The rules themselves live in one place —
   * `src/lib/safety/burst-detection.ts` — so the two adapters cannot disagree
   * about what counts as a burst.
   */
  async listPropertyFlags(
    status: PropertyFlagStatus = 'open',
  ): Promise<Array<{ flag: PropertyFlag; property: Property }>> {
    const database = await getDatabase();
    const usersById = new Map(database.users.map((user) => [user.id, user]));
    const propertiesById = new Map(database.properties.map((p) => [p.id, p]));

    const signals = database.reviews
      .filter((review) => review.status === 'published')
      .flatMap((review) => {
        // A review whose author has deleted their account carries no account-age
        // signal, so it cannot contribute to new-account-concentration and is
        // skipped rather than counted with a fabricated date. It still exists on
        // the property page; it simply stops being evidence about *who* wrote it,
        // which is the entire point of unlinking.
        const author = review.authorId ? usersById.get(review.authorId) : undefined;
        if (!author) return [];
        return [
          {
            propertyId: review.propertyId,
            createdAt: review.createdAt,
            overallRating: review.overallRating,
            authorCreatedAt: author.createdAt,
          },
        ];
      });

    return detectPropertyFlags(signals)
      .flatMap((finding) => {
        const property = propertiesById.get(finding.propertyId);
        if (!property) return [];

        // A decision holds for the same cooldown the SQL detector applies, so
        // the two adapters agree: a moderator who has looked at this is not
        // shown it again tomorrow, and a pattern still running next week is
        // raised afresh rather than staying silently dismissed forever.
        const decided = database.flagDecisions.find(
          (d) => d.propertyId === finding.propertyId && d.kind === finding.kind,
        );
        const withinCooldown =
          decided !== undefined &&
          Date.now() - new Date(decided.reviewedAt).getTime() <
            FLAG_DECISION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
        const decision = withinCooldown ? decided : undefined;

        const flag: PropertyFlag = {
          // Stable for as long as the finding is: a decision has to survive
          // the next recomputation to mean anything.
          id: `flag-${finding.propertyId}-${finding.kind}`,
          propertyId: finding.propertyId,
          kind: finding.kind,
          severity: finding.severity,
          windowStart: finding.windowStart,
          windowEnd: finding.windowEnd,
          observed: finding.observed,
          detail: finding.detail,
          status: decision?.status ?? 'open',
          reviewedBy: decision?.reviewedBy ?? null,
          reviewedAt: decision?.reviewedAt ?? null,
          createdAt: finding.windowEnd,
        };

        return [{ flag, property }];
      })
      .filter((entry) => entry.flag.status === status);
  }

  async decidePropertyFlag(
    flagId: string,
    status: Extract<PropertyFlagStatus, 'reviewed' | 'dismissed'>,
    actorId: string,
  ): Promise<void> {
    const flags = await this.listPropertyFlags('open');
    const target = flags.find((entry) => entry.flag.id === flagId);
    if (!target) throw new Error('Flag not found');

    const { propertyId, kind } = target.flag;

    await mutate((database) => {
      const existing = database.flagDecisions.find(
        (d) => d.propertyId === propertyId && d.kind === kind,
      );
      const decision = { propertyId, kind, status, reviewedBy: actorId, reviewedAt: nowIso() };

      if (existing) Object.assign(existing, decision);
      else database.flagDecisions.push(decision);

      database.moderationActions.push({
        id: `action-${shortId(12)}`,
        actorId,
        subjectType: 'property',
        subjectId: propertyId,
        action: `flag_${status}:${kind}`,
        reason: null,
        previousStatus: 'open',
        newStatus: status,
        createdAt: nowIso(),
      });
    });
  }

  async recordModerationAction(
    input: Omit<ModerationAction, 'id' | 'createdAt'>,
  ): Promise<ModerationAction> {
    return mutate((database) => {
      const action: ModerationAction = {
        ...input,
        id: `action-${shortId(12)}`,
        createdAt: nowIso(),
      };
      database.moderationActions.push(action);
      return action;
    });
  }

  async listModerationActions(subjectId?: string, limit = 50): Promise<ModerationAction[]> {
    const database = await getDatabase();
    return database.moderationActions
      .filter((action) => !subjectId || action.subjectId === subjectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  /* ---------------------------------------------------------------------
   * Identity
   * ------------------------------------------------------------------ */

  /**
   * Reveals an account's email address.
   *
   * Postgres does this inside one transaction, so the disclosure and its record
   * cannot come apart. There are no transactions here, so the record is written
   * *first* and the address is returned only if that succeeded — the same
   * guarantee in the only order that can provide it without one.
   *
   * Every rule `livd_reveal_user_identity` enforces is enforced here, in the
   * same order, for the same reason as `setUserRole`: the security tests run
   * against this adapter, and a test that pins the wrong behaviour is worse
   * than no test.
   */
  async revealUserIdentity(input: {
    userId: string;
    reasonKey: string;
    reasonDetail: string | null;
    caseReference: string | null;
    actorIpHash: string | null;
    actorId: string;
  }): Promise<IdentityReveal> {
    const reason = IDENTITY_ACCESS_REASONS.find((entry) => entry.key === input.reasonKey);
    if (!reason) throw new Error('Select a reason for this access');

    if (reason.requiresDetail && (input.reasonDetail ?? '').trim().length < 10) {
      throw new Error('This reason needs a written explanation');
    }

    const database = await getDatabase();

    const actor = database.users.find((u) => u.id === input.actorId);
    const actorIsTrusted =
      actor?.status === 'active' && (actor.role === 'trust_admin' || actor.role === 'admin');

    if (!actorIsTrusted) {
      throw new Error('Revealing an account identity requires Trust and Safety authorisation');
    }

    const target = database.users.find((u) => u.id === input.userId);
    if (!target) throw new Error('No such account');

    const detail = (input.reasonDetail ?? '').trim();
    const combined = detail ? `${reason.label} — ${detail}` : reason.label;

    const auditEntryId = `audit-${shortId(12)}`;

    // Written before the address is returned. If this throws, nothing is
    // disclosed.
    await mutate((db) => {
      db.adminAudit.push({
        id: auditEntryId,
        actorId: actor.id,
        actorRole: actor.role,
        action: 'identity_revealed',
        subjectType: 'user',
        subjectId: input.userId,
        outcome: 'succeeded',
        reason: combined,
        detail: {
          reasonKey: input.reasonKey,
          ...(input.caseReference?.trim()
            ? { caseReference: input.caseReference.trim() }
            : {}),
          fields: 'email,account_metadata',
        },
        createdAt: nowIso(),
      });
    });

    return {
      email: target.email,
      accountId: target.id,
      role: target.role,
      status: target.status,
      countryCode: target.countryCode,
      createdAt: target.createdAt,
      auditEntryId,
    };
  }

  async listIdentityAccessReasons(): Promise<IdentityAccessReason[]> {
    return IDENTITY_ACCESS_REASONS.map((entry) => ({ ...entry }));
  }

  async listIdentityAccess(userId: string, limit = 20): Promise<IdentityAccessRecord[]> {
    const database = await getDatabase();

    return database.adminAudit
      .filter((entry) => entry.action === 'identity_revealed' && entry.subjectId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map((entry) => ({
        id: entry.id,
        actorId: entry.actorId,
        actorRole: entry.actorRole,
        outcome: entry.outcome,
        reason: entry.reason,
        caseReference:
          typeof entry.detail.caseReference === 'string' ? entry.detail.caseReference : null,
        createdAt: entry.createdAt,
      }));
  }

  /* ---------------------------------------------------------------------
   * Administrative audit
   * ------------------------------------------------------------------ */

  /**
   * Records one sensitive administrative access.
   *
   * Postgres stamps the actor from `auth.uid()` inside
   * `livd_record_admin_audit`, so an entry there cannot name an author who did
   * not do the thing. There is no session here, so the actor comes from the
   * context the layer already established — which is the same asymmetry as
   * `setUserRole`, and the same reason: this adapter is for development, and
   * the guarantee that matters is the one Postgres makes.
   */
  async recordAdminAudit(entry: AdminAuditEntry): Promise<void> {
    await mutate((database) => {
      const actor = database.users.find((u) => u.id === entry.actorId);

      database.adminAudit.push({
        id: `audit-${shortId(12)}`,
        actorId: actor?.id ?? null,
        // The role at the time, captured now rather than read back later. A
        // demotion must not rewrite what somebody was when they did this.
        actorRole: actor?.role ?? 'resident',
        action: entry.action,
        subjectType: entry.subjectType,
        subjectId: entry.subjectId,
        outcome: entry.outcome,
        reason: entry.reason,
        detail: entry.detail,
        createdAt: nowIso(),
      });
    });
  }

  async listAdminAudit(
    options: {
      page?: number;
      pageSize?: number;
      action?: string | null;
      subjectId?: string | null;
    } = {},
  ): Promise<AdminAuditPage> {
    const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 200);
    const page = Math.max(options.page ?? 1, 1);

    const database = await getDatabase();

    const all = database.adminAudit
      .filter((entry) => !options.action || entry.action === options.action)
      .filter((entry) => !options.subjectId || entry.subjectId === options.subjectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));

    const start = (page - 1) * pageSize;

    return {
      items: all.slice(start, start + pageSize).map((entry) => ({ ...entry })),
      total: all.length,
      page,
      pageSize,
    };
  }

  /* ---------------------------------------------------------------------
   * Claims & owner responses
   * ------------------------------------------------------------------ */

  async createClaim(input: {
    propertyId: string;
    claimantId: string;
    roleClaimed: PropertyClaim['roleClaimed'];
    organisation: string | null;
    contactEmail: string;
  }): Promise<PropertyClaim> {
    return mutate((database) => {
      const claim: PropertyClaim = {
        id: `claim-${shortId(12)}`,
        propertyId: input.propertyId,
        claimantId: input.claimantId,
        roleClaimed: input.roleClaimed,
        organisation: input.organisation,
        contactEmail: input.contactEmail,
        status: 'pending',
        reviewedBy: null,
        decidedAt: null,
        createdAt: nowIso(),
      };
      database.claims.push(claim);
      return claim;
    });
  }

  async listClaims(
    status?: ClaimStatus,
  ): Promise<Array<{ claim: PropertyClaim; property: Property }>> {
    const database = await getDatabase();
    const propertiesById = new Map(database.properties.map((p) => [p.id, p]));

    return database.claims
      .filter((claim) => !status || claim.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .flatMap((claim) => {
        const property = propertiesById.get(claim.propertyId);
        return property ? [{ claim, property }] : [];
      });
  }

  async decideClaim(
    claimId: string,
    status: Extract<ClaimStatus, 'approved' | 'rejected'>,
    actorId: string,
  ): Promise<void> {
    await mutate((database) => {
      const claim = database.claims.find((c) => c.id === claimId);
      if (!claim) throw new Error('Claim not found');

      // One approved claim per property.
      if (status === 'approved') {
        for (const other of database.claims) {
          if (other.propertyId === claim.propertyId && other.id !== claim.id && other.status === 'approved') {
            other.status = 'revoked';
            other.decidedAt = nowIso();
          }
        }
      }

      claim.status = status;
      claim.reviewedBy = actorId;
      claim.decidedAt = nowIso();

      database.moderationActions.push({
        id: `action-${shortId(12)}`,
        actorId,
        subjectType: 'claim',
        subjectId: claimId,
        action: `claim_${status}`,
        reason: null,
        previousStatus: 'pending',
        newStatus: status,
        createdAt: nowIso(),
      });
    });
  }

  async getApprovedClaim(propertyId: string): Promise<PropertyClaim | null> {
    const database = await getDatabase();
    return (
      database.claims.find(
        (claim) => claim.propertyId === propertyId && claim.status === 'approved',
      ) ?? null
    );
  }

  async isPropertyClaimed(propertyId: string): Promise<boolean> {
    const database = await getDatabase();
    return database.claims.some(
      (claim) => claim.propertyId === propertyId && claim.status === 'approved',
    );
  }

  async listClaimedPropertyIds(userId: string): Promise<string[]> {
    const database = await getDatabase();
    return database.claims
      .filter((claim) => claim.claimantId === userId && claim.status === 'approved')
      .map((claim) => claim.propertyId);
  }

  async createOwnerResponse(input: {
    reviewId: string;
    responderId: string;
    body: string;
    isResolutionNotice: boolean;
  }): Promise<void> {
    await mutate((database) => {
      const review = database.reviews.find((r) => r.id === input.reviewId);
      if (!review) throw new Error('Review not found');

      const claim = database.claims.find(
        (c) =>
          c.propertyId === review.propertyId &&
          c.claimantId === input.responderId &&
          c.status === 'approved',
      );
      if (!claim) throw new Error('Only an approved claimant may respond to reviews');

      // One response per review — a right of reply, not a comment thread.
      if (database.ownerResponses.some((response) => response.reviewId === input.reviewId)) {
        throw new Error('This review already has a response');
      }

      database.ownerResponses.push({
        id: `response-${shortId(12)}`,
        reviewId: input.reviewId,
        body: input.body,
        isResolutionNotice: input.isResolutionNotice,
        respondentRole: claim.roleClaimed,
        createdAt: nowIso(),
      });
    });
  }

  /* ---------------------------------------------------------------------
   * Saved properties
   * ------------------------------------------------------------------ */

  async listSavedProperties(
    userId: string,
  ): Promise<Array<SavedProperty & { summary: PropertySummary }>> {
    const database = await getDatabase();
    const propertiesById = new Map(visibleProperties(database).map((p) => [p.id, p]));

    return database.saved
      .filter((entry) => entry.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .flatMap((entry) => {
        const property = propertiesById.get(entry.propertyId);
        return property ? [{ ...entry, summary: summaryFor(database, property) }] : [];
      });
  }

  async saveProperty(userId: string, propertyId: string): Promise<void> {
    await mutate((database) => {
      const exists = database.saved.some(
        (entry) => entry.userId === userId && entry.propertyId === propertyId,
      );
      if (exists) return;
      database.saved.push({ userId, propertyId, note: null, createdAt: nowIso() });
    });
  }

  async unsaveProperty(userId: string, propertyId: string): Promise<void> {
    await mutate((database) => {
      database.saved = database.saved.filter(
        (entry) => !(entry.userId === userId && entry.propertyId === propertyId),
      );
    });
  }

  async isPropertySaved(userId: string, propertyId: string): Promise<boolean> {
    const database = await getDatabase();
    return database.saved.some(
      (entry) => entry.userId === userId && entry.propertyId === propertyId,
    );
  }

  async setSavedPropertyNote(
    userId: string,
    propertyId: string,
    note: string | null,
  ): Promise<void> {
    await mutate((database) => {
      const entry = database.saved.find(
        (candidate) => candidate.userId === userId && candidate.propertyId === propertyId,
      );
      if (entry) entry.note = note;
    });
  }

  /* ---------------------------------------------------------------------
   * Users
   * ------------------------------------------------------------------ */

  async getUserById(id: string): Promise<UserProfile | null> {
    const database = await getDatabase();
    return database.users.find((user) => user.id === id) ?? null;
  }

  async findUserIdByEmail(email: string): Promise<string | null> {
    const database = await getDatabase();
    const normalised = email.trim().toLowerCase();
    const match = database.users.find((user) => user.email.toLowerCase() === normalised);
    return match?.id ?? null;
  }

  async upsertUser(input: {
    id?: string;
    email: string;
    countryCode?: string | null;
  }): Promise<UserProfile> {
    return mutate((database) => {
      const normalised = input.email.trim().toLowerCase();
      const existing = database.users.find((user) => user.email.toLowerCase() === normalised);

      if (existing) {
        if (input.countryCode !== undefined) existing.countryCode = input.countryCode;
        return existing;
      }

      const user: UserProfile = {
        id: input.id ?? `user-${shortId(12)}`,
        email: normalised,
        // The first account created in a fresh local store is an admin, so the
        // moderation tools are reachable during development without a fixture.
        role: database.users.some((u) => !u.id.startsWith('demo-')) ? 'resident' : 'admin',
        status: 'active',
        countryCode: input.countryCode ?? null,
        preferredLocale: 'en',
        createdAt: nowIso(),
      };

      database.users.push(user);
      return user;
    });
  }

  /**
   * One page of the administrative user directory.
   *
   * Postgres masks inside `livd_admin_user_directory`, before the row leaves
   * the database. There is no database here, so the mask is applied as the
   * summary is built — and the address is dropped on the same line it is read,
   * never carried into the returned object. `tests/safety/identity.test.ts`
   * pins the two rules to each other.
   */
  async listAdminUsers(filters: AdminUserFilters = {}): Promise<AdminUserPage> {
    const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 100);
    const page = Math.max(filters.page ?? 1, 1);

    const database = await getDatabase();

    const term = filters.search?.trim().toLowerCase() || null;
    const searchingByEmail = term !== null && term.includes('@');

    const all = database.users
      .filter((user) => !user.id.startsWith('demo-user-'))
      .filter((user) => {
        if (term === null) return true;
        // An address is matched exactly; an id is matched by prefix. An
        // internal identifier is looked up, never trawled.
        return searchingByEmail
          ? user.email.toLowerCase() === term
          : user.id.toLowerCase().startsWith(term);
      })
      .filter((user) => !filters.role || user.role === filters.role)
      .filter((user) => !filters.status || user.status === filters.status)
      .filter((user) => !filters.joinedAfter || user.createdAt >= filters.joinedAfter)
      .map((user) => ({ user, counts: countsFor(database, user.id) }))
      .filter(({ counts }) =>
        filters.hasVerifiedReviews === null || filters.hasVerifiedReviews === undefined
          ? true
          : filters.hasVerifiedReviews
            ? counts.verifiedReviewCount > 0
            : counts.verifiedReviewCount === 0,
      )
      .filter(({ counts }) =>
        filters.hasReports === null || filters.hasReports === undefined
          ? true
          : filters.hasReports
            ? counts.reportsAgainst > 0
            : counts.reportsAgainst === 0,
      )
      .filter(({ counts }) => !filters.minReviews || counts.reviewCount >= filters.minReviews)
      .sort(
        (a, b) =>
          b.user.createdAt.localeCompare(a.user.createdAt) || b.user.id.localeCompare(a.user.id),
      );

    const start = (page - 1) * pageSize;

    return {
      items: all.slice(start, start + pageSize).map(({ user, counts }) => ({
        id: user.id,
        maskedEmail: maskEmail(user.email),
        role: user.role,
        status: user.status,
        countryCode: user.countryCode,
        createdAt: user.createdAt,
        reviewCount: counts.reviewCount,
        verifiedReviewCount: counts.verifiedReviewCount,
        reportsAgainst: counts.reportsAgainst,
        lastReviewAt: counts.lastReviewAt,
      })),
      total: all.length,
      page,
      pageSize,
    };
  }

  async getAdminUserDetail(userId: string): Promise<AdminUserDetail | null> {
    const database = await getDatabase();
    const user = database.users.find((u) => u.id === userId);
    if (!user) return null;

    const counts = countsFor(database, userId);

    return {
      id: user.id,
      maskedEmail: maskEmail(user.email),
      role: user.role,
      status: user.status,
      countryCode: user.countryCode,
      preferredLocale: user.preferredLocale,
      createdAt: user.createdAt,
      ...counts,
    };
  }

  async listAdminUserReviews(
    userId: string,
    options: { page?: number; pageSize?: number } = {},
  ): Promise<{ items: AdminUserReview[]; total: number; page: number; pageSize: number }> {
    const pageSize = Math.min(Math.max(options.pageSize ?? 25, 1), 100);
    const page = Math.max(options.page ?? 1, 1);

    const database = await getDatabase();

    const all = database.reviews
      .filter((review) => review.authorId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));

    const start = (page - 1) * pageSize;

    const items = all
      .slice(start, start + pageSize)
      .map((review) => {
        const property = database.properties.find((p) => p.id === review.propertyId);
        if (!property) return null;

        return {
          reviewId: review.id,
          propertyId: property.id,
          propertySlug: property.slug,
          address: property.address,
          overallRating: review.overallRating,
          residencyStatus: review.residencyStatus,
          verificationLevel: review.verificationLevel,
          status: review.status,
          createdAt: review.createdAt,
          reportCount: database.reports.filter((r) => r.reviewId === review.id).length,
        };
      })
      .filter((entry): entry is AdminUserReview => entry !== null);

    return { items, total: all.length, page, pageSize };
  }

  async listAdminUserReports(
    userId: string,
    options: { page?: number; pageSize?: number } = {},
  ): Promise<{ items: AdminUserReport[]; total: number; page: number; pageSize: number }> {
    const pageSize = Math.min(Math.max(options.pageSize ?? 25, 1), 100);
    const page = Math.max(options.page ?? 1, 1);

    const database = await getDatabase();
    const authored = new Set(
      database.reviews.filter((review) => review.authorId === userId).map((review) => review.id),
    );

    const all = database.reports
      .filter((report) => authored.has(report.reviewId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));

    const start = (page - 1) * pageSize;

    return {
      items: all.slice(start, start + pageSize).map((report) => ({
        reportId: report.id,
        reviewId: report.reviewId,
        reporterId: report.reporterId,
        reason: report.reason,
        detail: report.detail,
        status: report.status,
        resolution: report.resolution,
        createdAt: report.createdAt,
        resolvedAt: report.resolvedAt,
      })),
      total: all.length,
      page,
      pageSize,
    };
  }

  /**
   * Grants a role.
   *
   * Every rule `livd_set_user_role` enforces in Postgres is enforced here in
   * the same order, so the two adapters refuse the same requests for the same
   * reasons. That is not tidiness: the security tests run against this
   * adapter, in process, with no database — and a test that passes here is
   * only worth something if the behaviour it pins is the behaviour production
   * has.
   *
   * The one difference is where the actor comes from. Postgres reads
   * `auth.uid()` and cannot be told who is calling; here there is no session,
   * so `actorId` is the caller and the Server Action above is what established
   * it.
   */
  async setUserRole(
    userId: string,
    role: UserProfile['role'],
    actorId: string,
    reason: string,
  ): Promise<void> {
    await mutate((database) => {
      const actor = database.users.find((u) => u.id === actorId);
      if (!actor || actor.role !== 'admin' || actor.status !== 'active') {
        throw new Error('Only an administrator may change a role');
      }

      if (userId === actorId) throw new Error('You cannot change your own role');

      if (reason.trim().length < 3) {
        throw new Error('A reason is required, for the audit trail');
      }

      const user = database.users.find((u) => u.id === userId);
      if (!user) throw new Error('No such account');

      const previous = user.role;

      // Idempotent: a retried request must not write a second audit event.
      if (previous === role) return;

      if (previous === 'admin') {
        const remaining = database.users.filter(
          (u) => u.role === 'admin' && u.status === 'active' && u.id !== userId,
        ).length;
        if (remaining === 0) {
          throw new Error('This is the last administrator and cannot be demoted');
        }
      }

      user.role = role;

      database.moderationActions.push({
        id: `action-${shortId(12)}`,
        actorId,
        subjectType: 'user',
        subjectId: userId,
        action: 'role_changed',
        reason: reason.trim(),
        previousStatus: previous,
        newStatus: role,
        createdAt: nowIso(),
      });
    });
  }

  /** As `setUserRole`, mirroring `livd_set_user_status`. */
  async setUserStatus(
    userId: string,
    status: UserProfile['status'],
    actorId: string,
    reason: string,
  ): Promise<void> {
    await mutate((database) => {
      const actor = database.users.find((u) => u.id === actorId);
      const actorModerates =
        actor?.status === 'active' &&
        (actor.role === 'moderator' || actor.role === 'trust_admin' || actor.role === 'admin');

      if (!actorModerates) {
        throw new Error('Only a moderator may change an account standing');
      }

      if (userId === actorId) throw new Error('You cannot change your own standing');

      if (reason.trim().length < 3) {
        throw new Error('A reason is required, for the audit trail');
      }

      const user = database.users.find((u) => u.id === userId);
      if (!user) throw new Error('No such account');

      const targetIsPrivileged =
        user.role === 'moderator' || user.role === 'trust_admin' || user.role === 'admin';

      if (targetIsPrivileged && actor.role !== 'admin') {
        throw new Error('Only an administrator may act on a privileged account');
      }

      if (status === 'suspended' && actor.role !== 'trust_admin' && actor.role !== 'admin') {
        throw new Error('Suspending an account requires Trust and Safety authorisation');
      }

      const previous = user.status;
      if (previous === status) return;

      user.status = status;

      database.moderationActions.push({
        id: `action-${shortId(12)}`,
        actorId,
        subjectType: 'user',
        subjectId: userId,
        action: 'status_changed',
        reason: reason.trim(),
        previousStatus: previous,
        newStatus: status,
        createdAt: nowIso(),
      });
    });
  }

  /**
   * Erases an account.
   *
   * The order is the whole method. Evidence files are destroyed first, because
   * they are the only thing here the database cannot reach: a cascade removes
   * a verification row and leaves the tenancy agreement sitting on disk. Then
   * public contributions are severed rather than deleted, then everything
   * private is removed, and the profile goes last.
   *
   * Mirrors the foreign keys in migration 0017. The Postgres adapter gets the
   * same outcome from the database itself; here it is written out, because a
   * JSON file has no referential actions to lean on.
   */
  async deleteAccount(userId: string): Promise<AccountDeletionSummary> {
    // Read the evidence references before the rows are touched, and destroy the
    // files before anything else — a half-finished deletion must never be one
    // that dropped the row and kept the document.
    const database = await getDatabase();
    const evidence = database.verifications.filter((v) => v.submittedBy === userId);

    let evidenceFilesDestroyed = 0;
    for (const record of evidence) {
      if (await deleteEvidenceFile(record.evidenceRef)) evidenceFilesDestroyed += 1;
    }

    return mutate((db) => {
      let reviewsUnlinked = 0;
      for (const review of db.reviews) {
        if (review.authorId === userId) {
          // Severed, not removed. The property record is what the next renter
          // relies on, and every legal page promises it survives.
          review.authorId = null;
          reviewsUnlinked += 1;
        }
      }

      // Owner responses carry no author in this store — `OwnerResponse` is the
      // public shape and never held a responder id, so there is nothing here to
      // sever. Postgres does hold one, and migration 0017 nulls it there.
      const responsesUnlinked = 0;

      // The moderation record survives its author too — a history with gaps is
      // not a history.
      for (const action of db.moderationActions) {
        if (action.actorId === userId) action.actorId = null;
      }
      for (const report of db.reports) {
        if (report.reporterId === userId) report.reporterId = null;
      }

      const locationChecksDestroyed = db.propertyVerifications.filter(
        (v) => v.userId === userId,
      ).length;
      const savedPropertiesDestroyed = db.saved.filter((s2) => s2.userId === userId).length;

      db.propertyVerifications = db.propertyVerifications.filter((v) => v.userId !== userId);
      db.verifications = db.verifications.filter((v) => v.submittedBy !== userId);
      db.saved = db.saved.filter((s2) => s2.userId !== userId);
      db.helpfulVotes = db.helpfulVotes.filter((v) => v.voterId !== userId);
      db.claims = db.claims.filter((c) => c.claimantId !== userId);
      db.users = db.users.filter((u) => u.id !== userId);

      return {
        reviewsUnlinked,
        responsesUnlinked,
        evidenceFilesDestroyed,
        locationChecksDestroyed,
        savedPropertiesDestroyed,
      };
    });
  }

  /* ---------------------------------------------------------------------
   * Analytics
   * ------------------------------------------------------------------ */

  async recordSearch(input: {
    queryHash: string;
    countryCode: string | null;
    locality: string | null;
    resultCount: number;
  }): Promise<void> {
    await mutate((database) => {
      database.searchEvents.push({ ...input, occurredAt: nowIso() });
      // Bounded — this is a counter, not a log.
      if (database.searchEvents.length > 5000) {
        database.searchEvents = database.searchEvents.slice(-5000);
      }
    });
  }

  async adminOverview(): Promise<AdminOverview> {
    const database = await getDatabase();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    // Derived rather than counted: this adapter has no stored flags.
    const openFlags = await this.listPropertyFlags('open');

    return {
      propertyCount: database.properties.filter((p) => p.status === 'active').length,
      reviewCount: database.reviews.filter((r) => r.status === 'published').length,
      pendingModerationCount: database.reviews.filter((r) => r.status === 'pending_moderation')
        .length,
      openReportCount: database.reports.filter((r) => r.status === 'open').length,
      openFlagCount: openFlags.length,
      pendingVerificationCount: database.verifications.filter((v) => v.outcome === 'pending')
        .length,
      pendingClaimCount: database.claims.filter((c) => c.status === 'pending').length,
      userCount: database.users.filter((u) => !u.id.startsWith('demo-')).length,
      reviewsLast30Days: database.reviews.filter((r) => r.createdAt >= thirtyDaysAgo).length,
    };
  }
}

/* -------------------------------------------------------------------------
 * Deriving a review's verification level
 *
 * The TypeScript twin of `livd_derive_review_verification` in migration 0014.
 * Both exist for the same reason: a review must not be able to claim a level
 * its author did not earn, and the store — not the caller — is what decides.
 * ---------------------------------------------------------------------- */

/** A live, unexpired location verification this person may still attach. */
function liveVerificationFor(
  database: LocalDatabase,
  userId: string,
  propertyId: string,
): PropertyVerification | null {
  const now = Date.now();
  const reuseWindowMs = VERIFICATION_LIFETIME.reuseWindowMinutes * 60_000;

  return (
    database.propertyVerifications
      .filter(
        (v) =>
          v.userId === userId &&
          v.propertyId === propertyId &&
          v.status === 'verified' &&
          new Date(v.expiresAt).getTime() > now &&
          now - new Date(v.createdAt).getTime() <= reuseWindowMs,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}

function deriveReviewVerification(
  database: LocalDatabase,
  input: CreateReviewInput,
  authorId: string,
): Pick<Review, 'verificationLevel' | 'verificationId' | 'verifiedAt'> {
  const unverified = {
    verificationLevel: 'unverified' as VerificationLevel,
    verificationId: null,
    verifiedAt: null,
  };

  if (!input.verificationId) return unverified;

  const record = database.propertyVerifications.find((v) => v.id === input.verificationId);

  // Not this person's, or not this property's. Verify property A, submit a
  // review of property B, and this throws — the same refusal the database
  // trigger raises, rather than a quiet downgrade that would let the attempt
  // look successful.
  if (
    !record ||
    record.userId !== authorId ||
    record.propertyId !== input.propertyId ||
    record.status !== 'verified'
  ) {
    throw new Error('That verification does not belong to this review.');
  }

  // Expiry is ordinary and is forgiven. Someone who verified, was interrupted
  // and came back three hours later gets a published review without a badge,
  // never an error in front of what they have just written.
  if (new Date(record.expiresAt).getTime() <= Date.now()) return unverified;

  return {
    verificationLevel: record.method === 'location' ? 'location_verified' : 'unverified',
    verificationId: record.id,
    verifiedAt: record.createdAt,
  };
}

/* -------------------------------------------------------------------------
 * Verification evidence, on disk
 *
 * A tenancy agreement carries a name, an address and a signature. Even in a
 * development store it is kept out of the JSON document — partly so an 8MB
 * file is not rewritten on every unrelated mutation, and partly so the one
 * place it lives is a path that can be deleted.
 * ---------------------------------------------------------------------- */

const EVIDENCE_DIR = join(process.cwd(), '.data', 'verification');

async function writeEvidenceFile(id: string, data: Uint8Array): Promise<string> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const path = join(EVIDENCE_DIR, id);
  await writeFile(path, data);
  return id;
}

/** Removes one evidence file. Reports whether there was one to remove. */
async function deleteEvidenceFile(ref: string): Promise<boolean> {
  try {
    await rm(join(EVIDENCE_DIR, ref));
    return true;
  } catch {
    // Already gone, or the store was reset. Either way there is no document
    // left, which is the outcome being asked for.
    return false;
  }
}

async function readEvidenceAsDataUrl(ref: string, mime: string | null): Promise<string | null> {
  try {
    const data = await readFile(join(EVIDENCE_DIR, ref));
    return `data:${mime ?? 'application/octet-stream'};base64,${data.toString('base64')}`;
  } catch {
    // The store was reset while a record survived, or the file was removed by
    // hand. A moderator sees "evidence unavailable" rather than a crash.
    return null;
  }
}

/** Strips the object reference and the hash before anything leaves the adapter. */
function toPublicVerification(record: StoredVerification): VerificationRecord {
  const { evidenceRef: _ref, evidenceSha256: _hash, ...rest } = record;
  return rest;
}

/* -------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------- */

function compareForSort(
  a: PropertySummary,
  b: PropertySummary,
  sort: SearchFilters['sort'],
  scores: Map<string, number>,
): number {
  switch (sort) {
    case 'score_desc':
      return (b.intelligence.overallScore ?? -1) - (a.intelligence.overallScore ?? -1);
    case 'score_asc': {
      // Unscored properties sort last in both directions — an absent score is
      // not a low one.
      const aScore = a.intelligence.overallScore ?? Number.POSITIVE_INFINITY;
      const bScore = b.intelligence.overallScore ?? Number.POSITIVE_INFINITY;
      return aScore - bScore;
    }
    case 'reviews_desc':
      return b.intelligence.reviewCount - a.intelligence.reviewCount;
    case 'recent':
      return (b.intelligence.lastReviewAt ?? '').localeCompare(a.intelligence.lastReviewAt ?? '');
    default: {
      const delta =
        (scores.get(b.property.id) ?? 0) - (scores.get(a.property.id) ?? 0);
      if (delta !== 0) return delta;
      // Ties break toward the better-evidenced property.
      return b.intelligence.reviewCount - a.intelligence.reviewCount;
    }
  }
}

function computeTenure(movedInMonth: string, movedOutMonth: string | null): number {
  const start = new Date(movedInMonth);
  const end = movedOutMonth ? new Date(movedOutMonth) : new Date();
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth());
  return Math.max(1, months);
}

/** Kept for the address formatter's use in tests and future exports. */
export { formatAddressInline };
