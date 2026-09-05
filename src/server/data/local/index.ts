import 'server-only';

import { LIMITS, showDemoData } from '@/config/site';
import { buildPropertyIntelligence, emptyIntelligence } from '@/lib/intelligence';
import { matchScore, normaliseForSearch } from '@/lib/search/matching';
import { formatAddressInline, propertyContextLine, propertyDisplayName } from '@/lib/format';
import { propertySlug, shortId } from '@/lib/utils';
import type {
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
  VerificationLevel,
} from '@/types/domain';
import type {
  AdminOverview,
  CreatePropertyInput,
  CreateReviewInput,
  DiscoveryOptions,
  LivdRepository,
  LocalitySummary,
  ReviewListOptions,
  ReviewListResult,
} from '../repository';
import { toPublicReview } from '../public-review';
import { getDatabase, mutate, type LocalDatabase } from './store';

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
        coordinates: null,
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
      reviews = reviews.filter((review) => review.verificationLevel === 'verified_resident');
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
        verificationLevel: 'unverified',
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

  async getUserByEmail(email: string): Promise<UserProfile | null> {
    const database = await getDatabase();
    const normalised = email.trim().toLowerCase();
    return database.users.find((user) => user.email.toLowerCase() === normalised) ?? null;
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

  async listUsers(limit = 100): Promise<UserProfile[]> {
    const database = await getDatabase();
    return database.users
      .filter((user) => !user.id.startsWith('demo-user-'))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async setUserRole(
    userId: string,
    role: UserProfile['role'],
    actorId: string,
  ): Promise<void> {
    await mutate((database) => {
      const user = database.users.find((u) => u.id === userId);
      if (!user) throw new Error('User not found');

      const previous = user.role;
      user.role = role;

      database.moderationActions.push({
        id: `action-${shortId(12)}`,
        actorId,
        subjectType: 'user',
        subjectId: userId,
        action: `set_role:${role}`,
        reason: null,
        previousStatus: previous,
        newStatus: role,
        createdAt: nowIso(),
      });
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

    return {
      propertyCount: database.properties.filter((p) => p.status === 'active').length,
      reviewCount: database.reviews.filter((r) => r.status === 'published').length,
      pendingModerationCount: database.reviews.filter((r) => r.status === 'pending_moderation')
        .length,
      openReportCount: database.reports.filter((r) => r.status === 'open').length,
      pendingClaimCount: database.claims.filter((c) => c.status === 'pending').length,
      userCount: database.users.filter((u) => !u.id.startsWith('demo-')).length,
      reviewsLast30Days: database.reviews.filter((r) => r.createdAt >= thirtyDaysAgo).length,
    };
  }
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
