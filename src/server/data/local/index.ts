import 'server-only';

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { LIMITS, showDemoData } from '@/config/site';
import { buildPropertyIntelligence, emptyIntelligence } from '@/lib/intelligence';
import { matchScore, normaliseForSearch } from '@/lib/search/matching';
import { formatAddressInline, propertyContextLine, propertyDisplayName } from '@/lib/format';
import { propertySlug, shortId } from '@/lib/utils';
import type {
  AccountSignal,
  AdminUserDetail,
  AdminUserFilters,
  AuthorityRequest,
  AuthorityRequestStatus,
  AuthorityRequestType,
  CaseCategory,
  CaseEvidenceItem,
  CaseEvent,
  CaseFilters,
  CaseNote,
  CasePage,
  CasePriority,
  CaseStatus,
  CaseSummary,
  AdminUserPage,
  AdminUserReport,
  AdminUserReview,
  ClaimStatus,
  DisclosureRecord,
  ModerationAction,
  Property,
  PropertyClaim,
  PropertyIntelligence,
  PropertySummary,
  ReportStatus,
  Review,
  ReviewReport,
  ReviewInvestigation,
  ReviewReportEntry,
  ReviewSnapshot,
  Sanction,
  SanctionAction,
  SanctionReason,
  UserStatus,
  ReviewStatus,
  ReviewVerificationEntry,
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
import { normaliseAuditAction, type AdminAuditEntry } from '@/server/admin/audit';
import { VERIFICATION_LIFETIME } from '@/config/verification';
import { haversineMeters, isValidCoordinates } from '@/lib/geo/distance';
import { decideProximity, isImplausibleMovement } from '@/lib/geo/proximity';

/** Matches `p_cooldown_days` in `livd_detect_property_flags`. */
const FLAG_DECISION_COOLDOWN_DAYS = 7;
import type { AdminRole } from '@/types/domain';
import type {
  AdminAttention,
  AdminAuditPage,
  AuditActionSummary,
  AuditActorSummary,
  AuditFeedEntry,
  AttentionQueue,
  AuditFeedFilters,
  AuditFeedPage,
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
  NotificationPreferences,
  NotificationRecipient,
  ReviewListOptions,
  ReviewListResult,
} from '../repository';
import { toPublicReview } from '../public-review';
import {
  getDatabase,
  mutate,
  type LocalDatabase,
  type StoredUser,
  type StoredVerification,
} from './store';

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

/** Mirrors `case_category_defs`, migration 0026. */
const CASE_CATEGORIES: CaseCategory[] = [
  { key: 'spam', label: 'Spam', description: 'Promotional or automated content.', defaultPriority: 'low' },
  { key: 'fake_review', label: 'Fake review', description: 'A review by somebody who did not live there.', defaultPriority: 'medium' },
  { key: 'review_manipulation', label: 'Review manipulation', description: 'Coordinated or incentivised reviewing.', defaultPriority: 'high' },
  { key: 'harassment', label: 'Harassment', description: 'Targeted abuse of a person.', defaultPriority: 'high' },
  { key: 'threatening_content', label: 'Threatening content', description: 'Content that threatens harm.', defaultPriority: 'critical' },
  { key: 'hate_speech', label: 'Hate or abusive content', description: 'Abuse directed at a group.', defaultPriority: 'high' },
  { key: 'personal_information', label: 'Personal information', description: 'Content identifying a person.', defaultPriority: 'high' },
  { key: 'fraud', label: 'Fraud or scam', description: 'Attempted deception for gain.', defaultPriority: 'high' },
  { key: 'impersonation', label: 'Impersonation', description: 'Claiming to be somebody they are not.', defaultPriority: 'high' },
  { key: 'false_information', label: 'False or misleading information', description: 'Factual claims that appear untrue.', defaultPriority: 'medium' },
  { key: 'owner_dispute', label: 'Property owner dispute', description: 'An owner contests a resident experience.', defaultPriority: 'medium' },
  { key: 'safety_concern', label: 'Safety concern', description: 'A concern about conditions at a property.', defaultPriority: 'high' },
  { key: 'illegal_activity', label: 'Illegal activity claim', description: 'An allegation of unlawful conduct.', defaultPriority: 'high' },
  { key: 'other', label: 'Other', description: 'Anything else. Say what it is.', defaultPriority: 'medium' },
];

/** Postgres sorts `case_priority desc`; this is that order, explicitly. */
const CASE_PRIORITY_ORDER: Record<CasePriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/**
 * Establishes that the caller may work cases.
 *
 * Postgres asks `livd_is_moderator()`, which reads `auth.uid()`. There is no
 * session here, so the actor is passed in and checked the same way.
 */
/**
 * Preserves a review before it changes.
 *
 * Postgres does this with a BEFORE UPDATE trigger, so preservation happens
 * whatever path changed the row. There is no trigger here, so this is called
 * explicitly from the two methods that change a review — which is weaker, and
 * exactly why the guarantee that matters is the database's.
 */
/** Mirrors `sanction_reason_defs`, migration 0032. */
const SANCTION_REASONS: SanctionReason[] = [
  { key: 'spam', label: 'Spam', description: 'Promotional or automated posting.', suggestedAction: 'restricted' },
  { key: 'review_manipulation', label: 'Review manipulation', description: 'Coordinated, incentivised or fabricated reviewing.', suggestedAction: 'suspended' },
  { key: 'fabricated_content', label: 'Fabricated content', description: 'Reviewing a property they did not live at.', suggestedAction: 'suspended' },
  { key: 'harassment', label: 'Harassment', description: 'Targeted abuse of another person.', suggestedAction: 'suspended' },
  { key: 'threats', label: 'Threats', description: 'Content threatening harm to a person.', suggestedAction: 'banned' },
  { key: 'personal_information', label: 'Publishing personal information', description: 'Posting content that identifies a person.', suggestedAction: 'suspended' },
  { key: 'impersonation', label: 'Impersonation', description: 'Claiming to be somebody they are not.', suggestedAction: 'suspended' },
  { key: 'ban_evasion', label: 'Ban evasion', description: 'Returning after a ban under another account.', suggestedAction: 'banned' },
  { key: 'platform_abuse', label: 'Platform abuse', description: 'Abuse of reporting, verification or another system.', suggestedAction: 'restricted' },
  { key: 'other', label: 'Other', description: 'Anything else. Say what it is — this one is read.', suggestedAction: 'restricted' },
];

/**
 * Where an account sits on the administrative ladder.
 *
 * Postgres asks `livd_is_moderator` / `livd_is_trust_admin` /
 * `livd_is_super_admin`; this is the same three questions as one number, so a
 * severity check reads as a comparison rather than three branches.
 */
function adminRank(actor: UserProfile | undefined): number {
  if (!actor || actor.status !== 'active') return 0;
  if (actor.role === 'admin') return 3;
  if (actor.role === 'trust_admin') return 2;
  if (actor.role === 'moderator') return 1;
  return 0;
}

/** The strongest sanction still standing, or `active` when none is. */
function strongestStanding(database: LocalDatabase, userId: string): UserStatus {
  const now = new Date().toISOString();
  const severity: Record<SanctionAction, number> = { restricted: 1, suspended: 2, banned: 3 };

  const standing = database.sanctions
    .filter(
      (entry) =>
        entry.userId === userId &&
        entry.liftedAt === null &&
        (entry.endsAt === null || entry.endsAt > now),
    )
    .sort((a, b) => severity[b.action] - severity[a.action])[0];

  return standing?.action ?? 'active';
}

function snapshotReview(
  database: LocalDatabase,
  review: Review,
  reason: 'moderation' | 'correction' | 'verification' | 'other',
  changedBy: string | null,
): void {
  database.reviewSnapshots.push({
    id: `snapshot-${shortId(12)}`,
    reviewId: review.id,
    reason,
    body: review.body,
    overallRating: review.overallRating,
    wouldRecommend: review.wouldRecommend,
    verificationLevel: review.verificationLevel,
    status: review.status,
    safetyFlags: [...review.safetyFlags],
    categoryRatings: review.categoryRatings.map((rating) => ({ ...rating })),
    positiveTags: [...review.positiveTags],
    problemTags: [...review.problemTags],
    changedBy,
    createdAt: nowIso(),
  });
}

/**
 * Establishes that the caller may handle legal requests.
 *
 * Postgres asks `livd_is_trust_admin()`, which reads `auth.uid()`. There is no
 * session here, so the actor is passed in and checked the same way.
 */
function requireTrustAdmin(database: LocalDatabase, actorId: string, message: string) {
  const actor = database.users.find((u) => u.id === actorId);
  const trusted =
    actor?.status === 'active' && (actor.role === 'trust_admin' || actor.role === 'admin');

  if (!actor || !trusted) throw new Error(message);
  return actor;
}

function requireModerator(database: LocalDatabase, actorId: string, message: string) {
  const actor = database.users.find((u) => u.id === actorId);
  const canModerate =
    actor?.status === 'active' &&
    (actor.role === 'moderator' || actor.role === 'trust_admin' || actor.role === 'admin');

  if (!actor || !canModerate) throw new Error(message);
  return actor;
}

/**
 * The next id for an entry in either audit trail.
 *
 * Both trails are read together and sorted by timestamp then by id, and
 * entries written inside one `mutate` share a millisecond — a random id would
 * then decide the order of the record, which is the one thing a record must
 * not leave to chance. Zero-padded so lexicographic order is chronological,
 * matching the `bigserial` Postgres uses.
 *
 * Shared between the two trails rather than one counter each, so an
 * interleaved sequence of decisions and accesses reads in the order it
 * actually happened.
 */
function trailId(database: LocalDatabase): string {
  const sequence = String(database.nextTrailSeq).padStart(12, '0');
  database.nextTrailSeq += 1;
  return `trail-${sequence}`;
}

/**
 * Appends to a case timeline.
 *
 * Always called inside the same `mutate` as the change it describes, so a
 * status that moved without an event is not a state this store reaches either.
 */
function appendCaseEvent(
  database: LocalDatabase,
  caseId: string,
  actorId: string | null,
  kind: string,
  summary: string,
  detail: Record<string, unknown> = {},
): void {
  // Zero-padded so lexicographic order is chronological order, matching the
  // bigserial Postgres uses. Events written in the same millisecond still read
  // in the order they happened.
  const sequence = String(database.nextCaseEventSeq).padStart(12, '0');
  database.nextCaseEventSeq += 1;

  database.caseEvents.push({
    id: `event-${sequence}`,
    caseId,
    actorId,
    kind,
    summary,
    detail,
    createdAt: nowIso(),
  });
}

function toLocalCase(
  database: LocalDatabase,
  entry: LocalDatabase['cases'][number],
): CaseSummary {
  const property = entry.subjectPropertyId
    ? database.properties.find((p) => p.id === entry.subjectPropertyId)
    : undefined;

  return {
    id: entry.id,
    reference: entry.reference,
    status: entry.status,
    priority: entry.priority,
    category: entry.category,
    summary: entry.summary,
    outcome: entry.outcome,
    assignedTo: entry.assignedTo,
    openedBy: entry.openedBy,
    subjectReviewId: entry.subjectReviewId,
    subjectUserId: entry.subjectUserId,
    subjectPropertyId: entry.subjectPropertyId,
    property: property ? { slug: property.slug, address: property.address } : null,
    reportCount: database.reports.filter((r) => r.caseId === entry.id).length,
    noteCount: database.caseNotes.filter((n) => n.caseId === entry.id).length,
    preservationHold: entry.preservationHold,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    resolvedAt: entry.resolvedAt,
  };
}

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

      const changed =
        (patch.body !== undefined && patch.body !== review.body) ||
        (patch.wouldRecommend !== undefined && patch.wouldRecommend !== review.wouldRecommend);

      // Before the change, so the first snapshot a review gets is the state it
      // was published in.
      if (changed) snapshotReview(database, review, 'correction', authorId);

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

      // What the review said, kept before anything touches it. Postgres does
      // this with a trigger; here it is explicit, and the parity test is what
      // keeps the two agreeing.
      if (previousStatus !== status) {
        snapshotReview(database, review, 'moderation', actorId);
      }

      review.status = status;
      review.updatedAt = nowIso();

      database.moderationActions.push({
        id: trailId(database),
        actorId,
        actorRole: database.users.find((u) => u.id === actorId)?.role ?? null,
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
    reason: string,
  ): Promise<void> {
    if (!reason || reason.trim().length < 3) {
      throw new Error('A reason is required, for the audit trail');
    }

    await mutate((database) => {
      const review = database.reviews.find((r) => r.id === reviewId);
      if (!review) throw new Error('Review not found');

      const previous = review.verificationLevel;

      if (previous !== level) {
        snapshotReview(database, review, 'verification', actorId);
      }

      review.verificationLevel = level;
      review.updatedAt = nowIso();

      database.moderationActions.push({
        id: trailId(database),
        actorId,
        actorRole: database.users.find((u) => u.id === actorId)?.role ?? null,
        subjectType: 'review',
        subjectId: reviewId,
        action: `set_verification:${level}`,
        reason: reason.trim(),
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
        caseId: null,
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
        id: trailId(database),
        actorId,
        actorRole: database.users.find((u) => u.id === actorId)?.role ?? null,
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
        id: trailId(database),
        actorId,
        actorRole: database.users.find((u) => u.id === actorId)?.role ?? null,
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
      // The reason names the record this came from, so the entry in the trail
      // traces back to a document somebody approved rather than looking like
      // an unexplained manual override.
      await this.setReviewVerification(
        reviewId,
        'verified_resident',
        actorId,
        `Residency verification ${recordId} approved.`,
      );
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
          caseId: decision?.caseId ?? null,
          caseReference:
            database.cases.find((entry) => entry.id === decision?.caseId)?.reference ?? null,
          createdAt: finding.windowEnd,
        };

        return [{ flag, property }];
      })
      .filter((entry) => entry.flag.status === status);
  }

  async listAccountSignals(status: PropertyFlagStatus | null = 'open'): Promise<AccountSignal[]> {
    const database = await getDatabase();
    const casesById = new Map(database.cases.map((entry) => [entry.id, entry]));

    return database.accountSignals
      .filter((signal) => !status || signal.status === status)
      .sort((a, b) => b.severity - a.severity || b.createdAt.localeCompare(a.createdAt))
      .map((signal) => ({
        id: signal.id,
        userId: signal.userId,
        kind: signal.kind,
        severity: signal.severity,
        windowStart: signal.windowStart,
        windowEnd: signal.windowEnd,
        observed: signal.observed,
        detail: signal.detail,
        status: signal.status,
        caseId: signal.caseId,
        caseReference: signal.caseId ? (casesById.get(signal.caseId)?.reference ?? null) : null,
        createdAt: signal.createdAt,
      }));
  }

  async decideAccountSignal(
    signalId: string,
    status: Extract<PropertyFlagStatus, 'reviewed' | 'dismissed'>,
    actorId: string,
  ): Promise<void> {
    await mutate((database) => {
      requireModerator(database, actorId, 'Only a moderator may decide a signal');

      const signal = database.accountSignals.find((entry) => entry.id === signalId);
      if (!signal) throw new Error('No such signal');

      // Deciding a signal changes the signal. Nothing here touches the
      // account's standing or their reviews — those are separate decisions
      // with their own authorisation and their own written reasons.
      signal.status = status;
      signal.reviewedBy = actorId;
      signal.reviewedAt = nowIso();
    });
  }

  /**
   * Turns a signal into a case.
   *
   * The arithmetic goes into the case's first timeline event so somebody
   * reading it in three weeks sees what was observed rather than a paraphrase.
   * Nothing about the property, the reviews or the account changes.
   */
  async openCaseFromSignal(input: {
    signalKind: 'property' | 'account';
    signalId: string;
    why: string;
    actorId: string;
  }): Promise<string> {
    if (!input.why || input.why.trim().length < 3) {
      throw new Error('Say what you want looked into');
    }

    let observed: Record<string, number | string | null> = {};
    let subjectUserId: string | null = null;
    let subjectPropertyId: string | null = null;

    if (input.signalKind === 'account') {
      const database = await getDatabase();
      const signal = database.accountSignals.find((entry) => entry.id === input.signalId);
      if (!signal) throw new Error('No such signal');

      // Already investigated: hand back the case rather than opening a second.
      if (signal.caseId) return signal.caseId;

      observed = signal.observed;
      subjectUserId = signal.userId;
    } else {
      const flags = await this.listPropertyFlags('open');
      const decided = await this.listPropertyFlags('reviewed');
      const found = [...flags, ...decided].find((entry) => entry.flag.id === input.signalId);
      if (!found) throw new Error('No such signal');

      if (found.flag.caseId) return found.flag.caseId;

      observed = found.flag.observed;
      subjectPropertyId = found.flag.propertyId;
    }

    const caseId = await this.openCase({
      category: 'review_manipulation',
      summary: input.why.trim(),
      actorId: input.actorId,
    });

    await mutate((database) => {
      const entry = database.cases.find((c) => c.id === caseId);
      if (entry) {
        if (subjectUserId) entry.subjectUserId = subjectUserId;
        if (subjectPropertyId) entry.subjectPropertyId = subjectPropertyId;
      }

      if (input.signalKind === 'account') {
        const signal = database.accountSignals.find((sig) => sig.id === input.signalId);
        if (signal) {
          signal.caseId = caseId;
          signal.status = 'reviewed';
          signal.reviewedBy = input.actorId;
          signal.reviewedAt = nowIso();
        }
      } else {
        const [, propertyId, kind] = /^flag-(.+)-([a-z_]+)$/.exec(input.signalId) ?? [];
        const existing = database.flagDecisions.find(
          (d) => d.propertyId === propertyId && d.kind === kind,
        );
        const decision = {
          propertyId: propertyId ?? '',
          kind: (kind ?? 'review_burst') as PropertyFlag['kind'],
          status: 'reviewed' as const,
          reviewedBy: input.actorId,
          reviewedAt: nowIso(),
          caseId,
        };

        if (existing) Object.assign(existing, decision);
        else database.flagDecisions.push(decision);
      }

      appendCaseEvent(
        database,
        caseId,
        input.actorId,
        'signal_linked',
        'Opened from an automated signal',
        { signalKind: input.signalKind, signalId: input.signalId, ...observed },
      );
    });

    return caseId;
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
        id: trailId(database),
        actorId,
        actorRole: database.users.find((u) => u.id === actorId)?.role ?? null,
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
        actorRole:
          input.actorRole ??
          database.users.find((u) => u.id === input.actorId)?.role ??
          null,
        id: trailId(database),
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
   * Authority requests
   *
   * Records and reads. Nothing here gathers or transmits the information a
   * request asks for — the same absence as in Postgres, and for the same
   * reason.
   * ------------------------------------------------------------------ */

  async openAuthorityRequest(input: {
    requestingAuthority: string;
    jurisdiction: string;
    requestType: AuthorityRequestType;
    requestedInformation: string;
    externalReference: string | null;
    legalBasis: string | null;
    documentationReceived: boolean;
    subjectUserId: string | null;
    caseId: string | null;
    actorId: string;
  }): Promise<string> {
    return mutate((database) => {
      requireTrustAdmin(
        database,
        input.actorId,
        'Recording an authority request requires Trust and Safety authorisation',
      );

      if (input.requestingAuthority.trim().length < 2) {
        throw new Error('Name the requesting authority');
      }
      if (input.jurisdiction.trim().length < 2) throw new Error('Name the jurisdiction');
      if (input.requestedInformation.trim().length < 3) {
        throw new Error('Record what was asked for');
      }

      const id = `request-${shortId(12)}`;
      const reference = `AR-${database.nextCaseReference}`;
      database.nextCaseReference += 1;

      database.authorityRequests.push({
        id,
        reference,
        requestingAuthority: input.requestingAuthority.trim(),
        jurisdiction: input.jurisdiction.trim(),
        requestType: input.requestType,
        externalReference: input.externalReference?.trim() || null,
        requestedInformation: input.requestedInformation.trim(),
        legalBasis: input.legalBasis?.trim() || null,
        documentationReceived: input.documentationReceived,
        status: 'received',
        receivedAt: nowIso(),
        assignedTo: null,
        openedBy: input.actorId,
        decision: null,
        decidedBy: null,
        decidedAt: null,
        caseId: input.caseId,
        subjectUserId: input.subjectUserId,
        createdAt: nowIso(),
      });

      const actor = database.users.find((u) => u.id === input.actorId);
      database.adminAudit.push({
        id: trailId(database),
        actorId: input.actorId,
        actorRole: actor?.role ?? 'resident',
        action: 'authority_request_created',
        subjectType: 'authority_request',
        subjectId: id,
        outcome: 'succeeded',
        reason: `${input.requestingAuthority.trim()} — ${input.jurisdiction.trim()}`,
        detail: { reference, requestType: input.requestType, subjectUserId: input.subjectUserId },
        createdAt: nowIso(),
      });

      return id;
    });
  }

  async decideAuthorityRequest(input: {
    requestId: string;
    status: AuthorityRequestStatus;
    decision: string | null;
    documentationReceived: boolean | null;
    actorId: string;
  }): Promise<void> {
    await mutate((database) => {
      requireTrustAdmin(
        database,
        input.actorId,
        'Deciding an authority request requires Trust and Safety authorisation',
      );

      const request = database.authorityRequests.find((r) => r.id === input.requestId);
      if (!request) throw new Error('No such request');

      const concluding = (
        ['approved', 'partially_approved', 'declined', 'fulfilled', 'closed'] as const
      ).includes(input.status as 'approved');

      if (concluding && (input.decision ?? '').trim().length < 3) {
        throw new Error('Write the decision before concluding a request');
      }

      const previous = request.status;
      request.status = input.status;

      if (concluding) {
        request.decision = (input.decision ?? '').trim();
        request.decidedBy = input.actorId;
        request.decidedAt = nowIso();
      }
      if (input.documentationReceived !== null) {
        request.documentationReceived = input.documentationReceived;
      }

      const actor = database.users.find((u) => u.id === input.actorId);
      database.adminAudit.push({
        id: `audit-${shortId(12)}`,
        actorId: input.actorId,
        actorRole: actor?.role ?? 'resident',
        action: 'authority_request_updated',
        subjectType: 'authority_request',
        subjectId: input.requestId,
        outcome: 'succeeded',
        reason: (input.decision ?? '').trim() || null,
        detail: { from: previous, to: input.status },
        createdAt: nowIso(),
      });
    });
  }

  async recordDisclosure(input: {
    requestId: string;
    disclosedFields: string[];
    disclosedTo: string;
    method: DisclosureRecord['method'];
    notes: string | null;
    actorId: string;
  }): Promise<string> {
    return mutate((database) => {
      requireTrustAdmin(
        database,
        input.actorId,
        'Recording a disclosure requires Trust and Safety authorisation',
      );

      const request = database.authorityRequests.find((r) => r.id === input.requestId);
      if (!request) throw new Error('No such request');

      // A disclosure against a declined or undecided request is either a
      // mistake or something far worse. Either way it is refused.
      if (!['approved', 'partially_approved', 'fulfilled'].includes(request.status)) {
        throw new Error('That request has not been approved');
      }

      if (input.disclosedFields.length === 0) {
        throw new Error('Name exactly what was disclosed');
      }
      if (input.disclosedTo.trim().length < 2) throw new Error('Record who received it');

      const id = `disclosure-${shortId(12)}`;

      database.disclosures.push({
        id,
        requestId: input.requestId,
        subjectUserId: request.subjectUserId,
        disclosedFields: [...input.disclosedFields],
        disclosedTo: input.disclosedTo.trim(),
        method: input.method,
        authorisedBy: request.decidedBy,
        recordedBy: input.actorId,
        disclosedAt: nowIso(),
        notes: input.notes?.trim() || null,
      });

      request.status = 'fulfilled';

      const actor = database.users.find((u) => u.id === input.actorId);
      database.adminAudit.push({
        id: `audit-${shortId(12)}`,
        actorId: input.actorId,
        actorRole: actor?.role ?? 'resident',
        action: 'disclosure_recorded',
        subjectType: 'authority_request',
        subjectId: input.requestId,
        outcome: 'succeeded',
        reason: `Disclosed to ${input.disclosedTo.trim()}`,
        // The field names, never their values.
        detail: {
          disclosureId: id,
          reference: request.reference,
          fields: input.disclosedFields.join(','),
          method: input.method,
        },
        createdAt: nowIso(),
      });

      return id;
    });
  }

  async listAuthorityRequests(
    options: { status?: AuthorityRequestStatus | null; openOnly?: boolean; limit?: number } = {},
  ): Promise<AuthorityRequest[]> {
    const database = await getDatabase();

    return database.authorityRequests
      .filter((request) => !options.status || request.status === options.status)
      .filter(
        (request) =>
          !options.openOnly ||
          !(['fulfilled', 'declined', 'closed'] as string[]).includes(request.status),
      )
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id))
      .slice(0, Math.min(Math.max(options.limit ?? 50, 1), 200))
      .map((request) => ({
        id: request.id,
        reference: request.reference,
        requestingAuthority: request.requestingAuthority,
        jurisdiction: request.jurisdiction,
        requestType: request.requestType,
        externalReference: request.externalReference,
        requestedInformation: request.requestedInformation,
        legalBasis: request.legalBasis,
        documentationReceived: request.documentationReceived,
        status: request.status,
        receivedAt: request.receivedAt,
        assignedTo: request.assignedTo,
        decision: request.decision,
        decidedBy: request.decidedBy,
        decidedAt: request.decidedAt,
        caseId: request.caseId,
        caseReference:
          database.cases.find((c) => c.id === request.caseId)?.reference ?? null,
        subjectUserId: request.subjectUserId,
        disclosureCount: database.disclosures.filter((d) => d.requestId === request.id).length,
        createdAt: request.createdAt,
      }));
  }

  async listDisclosures(requestId: string | null = null): Promise<DisclosureRecord[]> {
    const database = await getDatabase();

    return database.disclosures
      .filter((entry) => !requestId || entry.requestId === requestId)
      .sort((a, b) => b.disclosedAt.localeCompare(a.disclosedAt) || b.id.localeCompare(a.id))
      .map((entry) => ({ ...entry, disclosedFields: [...entry.disclosedFields] }));
  }

  /* ---------------------------------------------------------------------
   * Sanctions
   *
   * Every rule `livd_apply_sanction` enforces is enforced here in the same
   * order: severity decides who may act, nobody sanctions themselves, only an
   * administrator acts on a privileged account, and a written reason is
   * required. Nothing here touches a review.
   * ------------------------------------------------------------------ */

  async applySanction(input: {
    userId: string;
    action: SanctionAction;
    reasonKey: string;
    reason: string;
    durationDays: number | null;
    caseId: string | null;
    actorId: string;
  }): Promise<string> {
    return mutate((database) => {
      const actor = database.users.find((u) => u.id === input.actorId);
      const rank = adminRank(actor);

      // Severity decides authorisation. The point at which a decision becomes
      // hard to reverse is the point at which it should need somebody senior.
      const required: Record<SanctionAction, number> = {
        restricted: 1,
        suspended: 2,
        banned: 3,
      };

      if (rank < required[input.action]) {
        throw new Error(
          input.action === 'restricted'
            ? 'Only a moderator may restrict an account'
            : input.action === 'suspended'
              ? 'Suspending an account requires Trust and Safety authorisation'
              : 'Only an administrator may ban an account',
        );
      }

      if (input.userId === input.actorId) {
        throw new Error('You cannot sanction your own account');
      }

      const target = database.users.find((u) => u.id === input.userId);
      if (!target) throw new Error('No such account');

      const targetIsPrivileged =
        target.role === 'moderator' || target.role === 'trust_admin' || target.role === 'admin';

      if (targetIsPrivileged && rank < 3) {
        throw new Error('Only an administrator may act on a privileged account');
      }

      const reasonDef = SANCTION_REASONS.find((entry) => entry.key === input.reasonKey);
      if (!reasonDef) throw new Error('Select a reason for this sanction');

      if (input.reason.trim().length < 3) {
        throw new Error('A reason is required, for the audit trail');
      }

      // A ban has no end date. Accepting one would imply it lifts by itself.
      const endsAt =
        input.action === 'banned' || !input.durationDays || input.durationDays <= 0
          ? null
          : new Date(Date.now() + input.durationDays * 86_400_000).toISOString();

      const id = `sanction-${shortId(12)}`;

      database.sanctions.push({
        id,
        userId: input.userId,
        action: input.action,
        reasonKey: input.reasonKey,
        reason: input.reason.trim(),
        caseId: input.caseId,
        appliedBy: input.actorId,
        startsAt: nowIso(),
        endsAt,
        liftedAt: null,
        liftedBy: null,
        liftedReason: null,
        createdAt: nowIso(),
      });

      target.status = input.action;

      database.adminAudit.push({
        id: `audit-${shortId(12)}`,
        actorId: input.actorId,
        actorRole: actor?.role ?? 'resident',
        action: 'user_sanctioned',
        subjectType: 'user',
        subjectId: input.userId,
        outcome: 'succeeded',
        reason: `${reasonDef.label} — ${input.reason.trim()}`,
        detail: {
          sanctionId: id,
          action: input.action,
          reasonKey: input.reasonKey,
          caseId: input.caseId,
          endsAt,
        },
        createdAt: nowIso(),
      });

      if (input.caseId) {
        appendCaseEvent(
          database,
          input.caseId,
          input.actorId,
          'sanction_applied',
          `Account ${input.action}`,
          { sanctionId: id, userId: input.userId },
        );
      }

      return id;
    });
  }

  async liftSanction(sanctionId: string, reason: string, actorId: string): Promise<void> {
    await mutate((database) => {
      if (reason.trim().length < 3) {
        throw new Error('A reason is required, for the audit trail');
      }

      const sanction = database.sanctions.find((entry) => entry.id === sanctionId);
      if (!sanction) throw new Error('No such sanction');

      const actor = database.users.find((u) => u.id === actorId);
      const rank = adminRank(actor);

      const required: Record<SanctionAction, number> = {
        restricted: 1,
        suspended: 2,
        banned: 3,
      };

      // Somebody who could not apply it should not be able to undo it either.
      if (rank < required[sanction.action]) {
        throw new Error(
          sanction.action === 'restricted'
            ? 'Only a moderator may lift a restriction'
            : sanction.action === 'suspended'
              ? 'Lifting a suspension requires Trust and Safety authorisation'
              : 'Only an administrator may lift a ban',
        );
      }

      if (sanction.liftedAt === null) {
        sanction.liftedAt = nowIso();
        sanction.liftedBy = actorId;
        sanction.liftedReason = reason.trim();
      }

      const target = database.users.find((u) => u.id === sanction.userId);
      if (target) target.status = strongestStanding(database, sanction.userId);

      database.adminAudit.push({
        id: `audit-${shortId(12)}`,
        actorId,
        actorRole: actor?.role ?? 'resident',
        action: 'user_sanction_lifted',
        subjectType: 'user',
        subjectId: sanction.userId,
        outcome: 'succeeded',
        reason: reason.trim(),
        detail: { sanctionId, was: sanction.action },
        createdAt: nowIso(),
      });

      if (sanction.caseId) {
        appendCaseEvent(
          database,
          sanction.caseId,
          actorId,
          'sanction_lifted',
          'Sanction lifted',
          { sanctionId },
        );
      }
    });
  }

  async listSanctions(
    options: { userId?: string | null; activeOnly?: boolean; limit?: number } = {},
  ): Promise<Sanction[]> {
    const database = await getDatabase();
    const now = new Date().toISOString();

    return database.sanctions
      .filter((entry) => !options.userId || entry.userId === options.userId)
      .map((entry) => ({
        id: entry.id,
        userId: entry.userId,
        action: entry.action,
        reasonKey: entry.reasonKey,
        reason: entry.reason,
        caseId: entry.caseId,
        caseReference:
          database.cases.find((c) => c.id === entry.caseId)?.reference ?? null,
        appliedBy: entry.appliedBy,
        startsAt: entry.startsAt,
        endsAt: entry.endsAt,
        liftedAt: entry.liftedAt,
        liftedBy: entry.liftedBy,
        liftedReason: entry.liftedReason,
        isActive: entry.liftedAt === null && (entry.endsAt === null || entry.endsAt > now),
        createdAt: entry.createdAt,
      }))
      .filter((entry) => !options.activeOnly || entry.isActive)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, Math.min(Math.max(options.limit ?? 50, 1), 200));
  }

  async listSanctionReasons(): Promise<SanctionReason[]> {
    return SANCTION_REASONS.map((entry) => ({ ...entry }));
  }

  /* ---------------------------------------------------------------------
   * Evidence
   *
   * Postgres snapshots a review by trigger, so preservation happens whatever
   * changed the row. There are no triggers here, so `snapshotReview` is called
   * from the two methods that change a review — and the parity test is what
   * keeps the two honest.
   * ------------------------------------------------------------------ */

  async listReviewSnapshots(reviewId: string): Promise<ReviewSnapshot[]> {
    const database = await getDatabase();

    return database.reviewSnapshots
      .filter((snapshot) => snapshot.reviewId === reviewId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, 50)
      .map((snapshot) => ({
        id: snapshot.id,
        reason: snapshot.reason,
        body: snapshot.body,
        overallRating: snapshot.overallRating,
        wouldRecommend: snapshot.wouldRecommend,
        verificationLevel: snapshot.verificationLevel,
        status: snapshot.status,
        safetyFlags: snapshot.safetyFlags,
        categoryRatings: snapshot.categoryRatings,
        positiveTags: snapshot.positiveTags,
        problemTags: snapshot.problemTags,
        changedBy: snapshot.changedBy,
        createdAt: snapshot.createdAt,
      }));
  }

  async listCaseEvidence(caseId: string): Promise<CaseEvidenceItem[]> {
    const database = await getDatabase();

    return database.caseEvidence
      .filter((item) => item.caseId === caseId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        description: item.description,
        mime: item.mime,
        bytes: item.bytes,
        hasFile: item.storageRef !== null,
        snapshotId: item.snapshotId,
        version: item.version,
        supersedes: item.supersedes,
        superseded: database.caseEvidence.some((other) => other.supersedes === item.id),
        addedBy: item.addedBy,
        withdrawnAt: item.withdrawnAt,
        withdrawnBy: item.withdrawnBy,
        withdrawnReason: item.withdrawnReason,
        createdAt: item.createdAt,
      }));
  }

  async addCaseEvidence(input: {
    caseId: string;
    kind: CaseEvidenceItem['kind'];
    title: string;
    description: string | null;
    supersedes: string | null;
    actorId: string;
  }): Promise<string> {
    return mutate((database) => {
      requireModerator(database, input.actorId, 'Only a moderator may add evidence');

      if (input.title.trim().length < 1) throw new Error('Evidence needs a title');

      if (!database.cases.some((c) => c.id === input.caseId)) {
        throw new Error('No such case');
      }

      let version = 1;
      if (input.supersedes) {
        const previous = database.caseEvidence.find(
          (item) => item.id === input.supersedes && item.caseId === input.caseId,
        );
        if (!previous) throw new Error('No such evidence on this case');
        version = previous.version + 1;
      }

      const id = `evidence-${shortId(12)}`;

      database.caseEvidence.push({
        id,
        caseId: input.caseId,
        kind: input.kind,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        storageRef: null,
        mime: null,
        bytes: null,
        sha256: null,
        snapshotId: null,
        version,
        supersedes: input.supersedes,
        addedBy: input.actorId,
        withdrawnAt: null,
        withdrawnBy: null,
        withdrawnReason: null,
        createdAt: nowIso(),
      });

      appendCaseEvent(
        database,
        input.caseId,
        input.actorId,
        'evidence_added',
        input.supersedes ? `Evidence replaced with version ${version}` : 'Evidence added',
        { evidenceId: id, kind: input.kind, version, supersedes: input.supersedes },
      );

      return id;
    });
  }

  async withdrawCaseEvidence(
    evidenceId: string,
    reason: string,
    actorId: string,
  ): Promise<void> {
    await mutate((database) => {
      requireModerator(database, actorId, 'Only a moderator may withdraw evidence');

      if (reason.trim().length < 3) {
        throw new Error('A reason is required, for the audit trail');
      }

      const item = database.caseEvidence.find((entry) => entry.id === evidenceId);
      if (!item) throw new Error('No such evidence');

      if (item.withdrawnAt === null) {
        item.withdrawnAt = nowIso();
        item.withdrawnBy = actorId;
        item.withdrawnReason = reason.trim();
      }

      appendCaseEvent(
        database,
        item.caseId,
        actorId,
        'evidence_withdrawn',
        'Evidence withdrawn',
        { evidenceId, reason: reason.trim() },
      );
    });
  }

  /* ---------------------------------------------------------------------
   * Review investigation
   * ------------------------------------------------------------------ */

  async getReviewInvestigation(reviewId: string): Promise<ReviewInvestigation | null> {
    const database = await getDatabase();

    const review = database.reviews.find((r) => r.id === reviewId);
    if (!review) return null;

    const property = database.properties.find((p) => p.id === review.propertyId);
    if (!property) return null;

    const author = review.authorId
      ? database.users.find((u) => u.id === review.authorId)
      : undefined;
    const authorCounts = review.authorId ? countsFor(database, review.authorId) : null;

    const propertyReviews = database.reviews.filter((r) => r.propertyId === property.id);
    const reportedReviewIds = new Set(
      database.reports
        .filter((report) => propertyReviews.some((r) => r.id === report.reviewId))
        .map((report) => report.reviewId),
    );

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const reports = database.reports.filter((report) => report.reviewId === reviewId);

    return {
      reviewId: review.id,
      body: review.body,
      overallRating: review.overallRating,
      wouldRecommend: review.wouldRecommend,
      residencyStatus: review.residencyStatus,
      movedInMonth: review.movedInMonth,
      movedOutMonth: review.movedOutMonth,
      tenureMonths: review.tenureMonths,
      verificationLevel: review.verificationLevel,
      verifiedAt: review.verifiedAt,
      status: review.status,
      safetyFlags: review.safetyFlags,
      helpfulCount: review.helpfulCount,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,

      author:
        author && authorCounts
          ? {
              id: author.id,
              status: author.status,
              createdAt: author.createdAt,
              reviewCount: authorCounts.reviewCount,
              removedReviewCount: authorCounts.removedReviewCount,
              reportsAgainst: authorCounts.reportsAgainst,
              verifiedReviewCount: authorCounts.verifiedReviewCount,
            }
          : null,

      property: {
        id: property.id,
        slug: property.slug,
        address: property.address,
        reviewCount: propertyReviews.filter((r) => r.status === 'published').length,
        reportedReviewCount: reportedReviewIds.size,
        verifiedReviewCount: propertyReviews.filter(
          (r) =>
            r.verificationLevel === 'location_verified' ||
            r.verificationLevel === 'verified_resident',
        ).length,
        recentReviewCount: propertyReviews.filter((r) => r.createdAt > ninetyDaysAgo).length,
        isClaimed: database.claims.some(
          (claim) => claim.propertyId === property.id && claim.status === 'approved',
        ),
      },

      reportCount: reports.length,
      openReportCount: reports.filter((report) => report.status === 'open').length,
      caseCount: database.cases.filter((c) => c.subjectReviewId === reviewId).length,
    };
  }

  async listReviewVerification(reviewId: string): Promise<ReviewVerificationEntry[]> {
    const database = await getDatabase();

    const review = database.reviews.find((r) => r.id === reviewId);
    if (!review?.authorId) return [];

    const location: ReviewVerificationEntry[] = database.propertyVerifications
      .filter((entry) => entry.userId === review.authorId)
      .map((entry) => ({
        kind: 'location' as const,
        id: entry.id,
        method: entry.method,
        outcome: entry.status,
        failureReason: entry.failureReason,
        atThisProperty: entry.propertyId === review.propertyId,
        createdAt: entry.createdAt,
        decidedAt: null,
        hasEvidence: false,
      }));

    const residency: ReviewVerificationEntry[] = database.verifications
      .filter((entry) => entry.submittedBy === review.authorId)
      .map((entry) => ({
        kind: 'residency' as const,
        id: entry.id,
        method: entry.method,
        outcome: entry.outcome,
        failureReason: null,
        atThisProperty: entry.subjectId === reviewId,
        createdAt: entry.createdAt,
        decidedAt: entry.decidedAt,
        hasEvidence: Boolean(entry.evidenceRef),
      }));

    return [...location, ...residency]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50);
  }

  async listReviewReports(reviewId: string): Promise<ReviewReportEntry[]> {
    const database = await getDatabase();

    return database.reports
      .filter((report) => report.reviewId === reviewId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((report) => {
        const linked = report.caseId
          ? database.cases.find((c) => c.id === report.caseId)
          : undefined;

        return {
          reportId: report.id,
          reporterId: report.reporterId,
          reason: report.reason,
          detail: report.detail,
          status: report.status,
          resolution: report.resolution,
          caseId: report.caseId,
          caseReference: linked?.reference ?? null,
          createdAt: report.createdAt,
          resolvedAt: report.resolvedAt,
        };
      });
  }

  /* ---------------------------------------------------------------------
   * Trust & Safety cases
   *
   * Every rule the `livd_*_case` functions enforce in Postgres is enforced
   * here, in the same order, and every write appends its timeline event
   * alongside the change. That mirroring is what lets the case tests run in
   * process on every commit and still mean something.
   * ------------------------------------------------------------------ */

  async openCase(input: {
    category: string;
    summary: string;
    fromReportId?: string | null;
    reviewId?: string | null;
    priority?: CasePriority | null;
    actorId: string;
  }): Promise<string> {
    return mutate((database) => {
      requireModerator(database, input.actorId, 'Only a moderator may open a case');

      if (input.summary.trim().length < 3) {
        throw new Error('A case needs a one-line summary');
      }

      const category = CASE_CATEGORIES.find((entry) => entry.key === input.category);
      if (!category) throw new Error('Select a category for this case');

      let reviewId = input.reviewId ?? null;

      if (input.fromReportId) {
        const report = database.reports.find((r) => r.id === input.fromReportId);
        if (!report) throw new Error('No such report');

        // Idempotent: a report already attached to a case hands that case back
        // rather than opening a second. Two moderators clicking at once is a
        // normal Tuesday.
        if (report.caseId) return report.caseId;

        reviewId = report.reviewId;
      }

      const review = reviewId ? database.reviews.find((r) => r.id === reviewId) : undefined;

      const id = `case-${shortId(12)}`;
      const reference = `LV-${database.nextCaseReference}`;
      database.nextCaseReference += 1;

      const timestamp = nowIso();

      database.cases.push({
        id,
        reference,
        status: 'new',
        priority: input.priority ?? category.defaultPriority,
        category: input.category,
        summary: input.summary.trim(),
        outcome: null,
        subjectReviewId: reviewId,
        subjectUserId: review?.authorId ?? null,
        subjectPropertyId: review?.propertyId ?? null,
        openedBy: input.actorId,
        assignedTo: null,
        preservationHold: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        resolvedAt: null,
      });

      appendCaseEvent(database, id, input.actorId, 'created', `Case opened as ${category.label}`, {
        category: input.category,
        priority: input.priority ?? category.defaultPriority,
        reference,
      });

      if (input.fromReportId) {
        const report = database.reports.find((r) => r.id === input.fromReportId);
        if (report) report.caseId = id;

        appendCaseEvent(database, id, input.actorId, 'report_linked', 'Report attached to this case', {
          reportId: input.fromReportId,
        });
      }

      return id;
    });
  }

  async listCases(filters: CaseFilters = {}): Promise<CasePage> {
    const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 100);
    const page = Math.max(filters.page ?? 1, 1);

    const database = await getDatabase();

    const all = database.cases
      .filter((entry) => !filters.status || entry.status === filters.status)
      .filter((entry) => !filters.priority || entry.priority === filters.priority)
      .filter((entry) => !filters.category || entry.category === filters.category)
      .filter((entry) => !filters.assignedTo || entry.assignedTo === filters.assignedTo)
      .filter((entry) => !filters.unassignedOnly || entry.assignedTo === null)
      .filter(
        (entry) =>
          !filters.openOnly ||
          !(['resolved', 'dismissed', 'closed'] as CaseStatus[]).includes(entry.status),
      )
      .filter(
        (entry) =>
          !filters.reference ||
          entry.reference.toUpperCase().startsWith(filters.reference.trim().toUpperCase()),
      )
      .sort(
        (a, b) =>
          CASE_PRIORITY_ORDER[b.priority] - CASE_PRIORITY_ORDER[a.priority] ||
          b.createdAt.localeCompare(a.createdAt),
      );

    const start = (page - 1) * pageSize;

    return {
      items: all.slice(start, start + pageSize).map((entry) => toLocalCase(database, entry)),
      total: all.length,
      page,
      pageSize,
    };
  }

  async getCase(caseId: string): Promise<CaseSummary | null> {
    const database = await getDatabase();
    const entry = database.cases.find((c) => c.id === caseId);
    return entry ? toLocalCase(database, entry) : null;
  }

  async listCaseEvents(caseId: string, limit = 200): Promise<CaseEvent[]> {
    const database = await getDatabase();

    return database.caseEvents
      .filter((event) => event.caseId === caseId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((event) => ({
        id: event.id,
        actorId: event.actorId,
        kind: event.kind,
        summary: event.summary,
        detail: event.detail,
        createdAt: event.createdAt,
      }));
  }

  async listCaseNotes(caseId: string, limit = 100): Promise<CaseNote[]> {
    const database = await getDatabase();

    return database.caseNotes
      .filter((note) => note.caseId === caseId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((note) => ({
        id: note.id,
        authorId: note.authorId,
        body: note.body,
        createdAt: note.createdAt,
      }));
  }

  async listCaseReports(caseId: string): Promise<ReviewReport[]> {
    const database = await getDatabase();
    return database.reports
      .filter((report) => report.caseId === caseId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listCaseCategories(): Promise<CaseCategory[]> {
    return CASE_CATEGORIES.map((entry) => ({ ...entry }));
  }

  async assignCase(caseId: string, assigneeId: string | null, actorId: string): Promise<void> {
    await mutate((database) => {
      requireModerator(database, actorId, 'Only a moderator may assign a case');

      const entry = database.cases.find((c) => c.id === caseId);
      if (!entry) throw new Error('No such case');

      if (assigneeId !== null) {
        const assignee = database.users.find((u) => u.id === assigneeId);
        const canWork =
          assignee?.status === 'active' &&
          (assignee.role === 'moderator' ||
            assignee.role === 'trust_admin' ||
            assignee.role === 'admin');

        if (!canWork) throw new Error('A case can only be assigned to an active moderator');
      }

      const previous = entry.assignedTo;
      if (previous === assigneeId) return;

      entry.assignedTo = assigneeId;
      // Picking up a new case starts it. Anything further along keeps its
      // status: reassigning an escalated case does not un-escalate it.
      if (entry.status === 'new' && assigneeId !== null) entry.status = 'open';
      entry.updatedAt = nowIso();

      appendCaseEvent(
        database,
        caseId,
        actorId,
        assigneeId === null ? 'unassigned' : 'assigned',
        assigneeId === null ? 'Case unassigned' : 'Case assigned',
        { from: previous, to: assigneeId },
      );
    });
  }

  async setCaseStatus(
    caseId: string,
    status: CaseStatus,
    outcome: string | null,
    actorId: string,
  ): Promise<void> {
    await mutate((database) => {
      requireModerator(database, actorId, 'Only a moderator may change a case');

      const entry = database.cases.find((c) => c.id === caseId);
      if (!entry) throw new Error('No such case');

      const concluding = (['resolved', 'dismissed', 'closed'] as CaseStatus[]).includes(status);

      // The point of the whole object: somebody reading LV-1048 in a year should
      // find what was decided, not just that it stopped being open.
      if (concluding && (outcome ?? '').trim().length < 3) {
        throw new Error('Say what was decided before closing a case');
      }

      const previous = entry.status;
      if (previous === status) return;

      entry.status = status;
      if (concluding) entry.outcome = (outcome ?? '').trim();
      if (status === 'resolved' || status === 'dismissed') entry.resolvedAt = nowIso();
      entry.updatedAt = nowIso();

      appendCaseEvent(
        database,
        caseId,
        actorId,
        'status_changed',
        `Status changed from ${previous} to ${status}`,
        { from: previous, to: status },
      );
    });
  }

  async setCasePriority(
    caseId: string,
    priority: CasePriority,
    why: string | null,
    actorId: string,
  ): Promise<void> {
    await mutate((database) => {
      const actor = requireModerator(database, actorId, 'Only a moderator may change a case');

      // Critical means somebody may be about to be hurt. It is a judgement, and
      // one Trust & Safety makes rather than one a queue drifts into.
      if (priority === 'critical' && actor.role !== 'trust_admin' && actor.role !== 'admin') {
        throw new Error('Raising a case to critical requires Trust and Safety authorisation');
      }

      const entry = database.cases.find((c) => c.id === caseId);
      if (!entry) throw new Error('No such case');

      const previous = entry.priority;
      if (previous === priority) return;

      entry.priority = priority;
      entry.updatedAt = nowIso();

      appendCaseEvent(
        database,
        caseId,
        actorId,
        'priority_changed',
        `Priority changed from ${previous} to ${priority}`,
        { from: previous, to: priority, why },
      );
    });
  }

  async addCaseNote(caseId: string, body: string, actorId: string): Promise<void> {
    await mutate((database) => {
      requireModerator(database, actorId, 'Only a moderator may add a note');

      if (body.trim().length < 1) throw new Error('A note needs something in it');

      const entry = database.cases.find((c) => c.id === caseId);
      if (!entry) throw new Error('No such case');

      database.caseNotes.push({
        id: `note-${shortId(12)}`,
        caseId,
        authorId: actorId,
        body: body.trim(),
        createdAt: nowIso(),
      });

      appendCaseEvent(database, caseId, actorId, 'note_added', 'Note added');
    });
  }

  async setCasePreservation(
    caseId: string,
    hold: boolean,
    why: string,
    actorId: string,
  ): Promise<void> {
    await mutate((database) => {
      const actor = database.users.find((u) => u.id === actorId);
      const trusted =
        actor?.status === 'active' && (actor.role === 'trust_admin' || actor.role === 'admin');

      if (!trusted) {
        throw new Error('Preservation holds require Trust and Safety authorisation');
      }

      if (why.trim().length < 3) {
        throw new Error('A reason is required, for the audit trail');
      }

      const entry = database.cases.find((c) => c.id === caseId);
      if (!entry) throw new Error('No such case');

      if (entry.preservationHold === hold) return;

      entry.preservationHold = hold;
      entry.updatedAt = nowIso();

      appendCaseEvent(
        database,
        caseId,
        actorId,
        hold ? 'preservation_applied' : 'preservation_lifted',
        hold ? 'Preservation hold applied' : 'Preservation hold lifted',
        { reason: why.trim() },
      );
    });
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

  /**
   * Both trails, unified for reading.
   *
   * The union happens here rather than in the store, exactly as it happens in
   * a query rather than in a table in Postgres. Two rows for one act could
   * disagree; one row read two ways cannot.
   *
   * Reading writes an `audit_log_read` entry, as `livd_admin_audit_feed` does.
   * There the read and the record are one statement block and cannot come
   * apart; here they are one `mutate` and the same discipline applies by
   * convention, which is the usual difference between the two adapters.
   */
  async listAuditFeed(filters: AuditFeedFilters = {}): Promise<AuditFeedPage> {
    const pageSize = Math.min(Math.max(filters.pageSize ?? 50, 1), 200);
    const page = Math.max(filters.page ?? 1, 1);

    const database = await getDatabase();
    const usersById = new Map(database.users.map((user) => [user.id, user]));

    const fromAudit: AuditFeedEntry[] = database.adminAudit.map((entry) => ({
      id: `a:${entry.id}`,
      source: 'audit' as const,
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      actorEmailMasked: entry.actorId
        ? maskEmail(usersById.get(entry.actorId)?.email ?? null)
        : null,
      action: normaliseAuditAction(entry.action),
      rawAction: entry.action,
      subjectType: entry.subjectType,
      subjectId: entry.subjectId,
      outcome: entry.outcome,
      reason: entry.reason,
      detail: entry.detail,
      createdAt: entry.createdAt,
    }));

    const fromModeration: AuditFeedEntry[] = database.moderationActions.map((entry) => ({
      id: `m:${entry.id}`,
      source: 'moderation' as const,
      actorId: entry.actorId,
      actorRole: entry.actorRole ?? null,
      actorEmailMasked: entry.actorId
        ? maskEmail(usersById.get(entry.actorId)?.email ?? null)
        : null,
      action: normaliseAuditAction(entry.action),
      rawAction: entry.action,
      subjectType: entry.subjectType,
      subjectId: entry.subjectId,
      // A moderation row exists only because the decision was made. There is
      // no refused-attempt equivalent in that trail, which is one of the
      // reasons the audit log exists alongside it.
      outcome: 'succeeded' as const,
      reason: entry.reason,
      detail: {
        ...(entry.previousStatus === null ? {} : { previousStatus: entry.previousStatus }),
        ...(entry.newStatus === null ? {} : { newStatus: entry.newStatus }),
      },
      createdAt: entry.createdAt,
    }));

    const all = [...fromAudit, ...fromModeration]
      .filter((entry) => !filters.source || entry.source === filters.source)
      .filter((entry) => !filters.action || entry.action === filters.action)
      .filter((entry) => !filters.actorId || entry.actorId === filters.actorId)
      .filter((entry) => !filters.outcome || entry.outcome === filters.outcome)
      .filter((entry) => !filters.subjectType || entry.subjectType === filters.subjectType)
      .filter((entry) => !filters.subjectId || entry.subjectId === filters.subjectId)
      .filter((entry) => !filters.since || entry.createdAt >= filters.since)
      .filter((entry) => !filters.until || entry.createdAt <= filters.until)
      // Hidden unless asked for, never removed. The page shows the count it is
      // hiding, which makes it a filter rather than a secret.
      .filter((entry) => filters.includeReads || entry.action !== 'audit_log_read')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));

    const start = (page - 1) * pageSize;
    const items = all.slice(start, start + pageSize);

    // After the page is taken, so a read does not appear in its own results.
    // `readerId` is how this adapter learns who is asking; Postgres reads it
    // from the session and ignores the argument entirely.
    if (filters.readerId) {
      await this.recordAdminAudit({
        actorId: filters.readerId,
        action: 'audit_log_read',
        subjectType: 'security',
        subjectId: filters.subjectId ?? null,
        outcome: 'succeeded',
        reason: null,
        detail: {
          source: filters.source ?? null,
          action: filters.action ?? null,
          actor: filters.actorId ?? null,
          outcome: filters.outcome ?? null,
          subjectType: filters.subjectType ?? null,
          since: filters.since ?? null,
          until: filters.until ?? null,
          includeReads: filters.includeReads ?? false,
          page,
        },
        actorIpHash: null,
      });
    }

    return { items, total: all.length, page, pageSize };
  }

  async auditActionSummary(since: string | null = null): Promise<AuditActionSummary[]> {
    const rows = await this.allTrailRows(since);
    const byAction = new Map<string, { entries: number; actors: Set<string>; denials: number; lastAt: string }>();

    for (const row of rows) {
      const bucket = byAction.get(row.action) ?? {
        entries: 0,
        actors: new Set<string>(),
        denials: 0,
        lastAt: row.createdAt,
      };
      bucket.entries += 1;
      if (row.actorId) bucket.actors.add(row.actorId);
      if (row.outcome === 'denied') bucket.denials += 1;
      if (row.createdAt > bucket.lastAt) bucket.lastAt = row.createdAt;
      byAction.set(row.action, bucket);
    }

    return [...byAction.entries()]
      .map(([action, bucket]) => ({
        action,
        entries: bucket.entries,
        actors: bucket.actors.size,
        denials: bucket.denials,
        lastAt: bucket.lastAt,
      }))
      .sort((a, b) => b.entries - a.entries || a.action.localeCompare(b.action));
  }

  async auditActors(since: string | null = null): Promise<AuditActorSummary[]> {
    const database = await getDatabase();
    const usersById = new Map(database.users.map((user) => [user.id, user]));
    const rows = await this.allTrailRows(since);

    const byActor = new Map<
      string,
      { role: UserProfile['role'] | null; entries: number; denials: number; lastAt: string }
    >();

    for (const row of rows) {
      if (!row.actorId) continue;
      const bucket = byActor.get(row.actorId) ?? {
        role: row.actorRole,
        entries: 0,
        denials: 0,
        lastAt: row.createdAt,
      };
      bucket.entries += 1;
      if (row.outcome === 'denied') bucket.denials += 1;
      // The most recent role seen in the trail, not the current one.
      if (row.createdAt >= bucket.lastAt) {
        bucket.lastAt = row.createdAt;
        if (row.actorRole) bucket.role = row.actorRole;
      }
      byActor.set(row.actorId, bucket);
    }

    return [...byActor.entries()]
      .map(([actorId, bucket]) => ({
        actorId,
        actorRole: bucket.role,
        actorEmailMasked: maskEmail(usersById.get(actorId)?.email ?? null),
        entries: bucket.entries,
        denials: bucket.denials,
        lastAt: bucket.lastAt,
      }))
      .sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
  }

  /** Both trails, unfiltered and unrecorded — the input to the two summaries. */
  private async allTrailRows(since: string | null): Promise<
    Array<{
      action: string;
      actorId: string | null;
      actorRole: UserProfile['role'] | null;
      outcome: 'succeeded' | 'denied' | 'failed';
      createdAt: string;
    }>
  > {
    const database = await getDatabase();

    return [
      ...database.adminAudit.map((entry) => ({
        action: normaliseAuditAction(entry.action),
        actorId: entry.actorId,
        actorRole: entry.actorRole as UserProfile['role'] | null,
        outcome: entry.outcome,
        createdAt: entry.createdAt,
      })),
      ...database.moderationActions.map((entry) => ({
        action: normaliseAuditAction(entry.action),
        actorId: entry.actorId,
        actorRole: entry.actorRole ?? null,
        outcome: 'succeeded' as const,
        createdAt: entry.createdAt,
      })),
    ].filter((row) => !since || row.createdAt >= since);
  }

  /**
   * What needs attention.
   *
   * Mirrors `livd_admin_attention` field for field. The Trust & Safety block
   * is null for anybody below that tier here too — the parity test is what
   * keeps the two answering the same question the same way.
   */
  async adminAttention(viewerId: string | null = null): Promise<AdminAttention> {
    const database = await getDatabase();

    // Flags are derived on read in this adapter rather than stored — there is
    // no scheduler here to write them — so the count comes from the same
    // computation the flags page uses, not from a table.
    const flags = await this.listPropertyFlags('open');

    const viewer = viewerId ? database.users.find((u) => u.id === viewerId) : undefined;
    const privileged = viewer?.role === 'trust_admin' || viewer?.role === 'admin';

    const queue = <T>(rows: T[], at: (row: T) => string): AttentionQueue => ({
      count: rows.length,
      oldest: rows.length === 0 ? null : rows.map(at).sort()[0] ?? null,
    });

    // Not concluded. A case in `action_taken` still needs somebody to close
    // it and one `escalated` needs somebody senior; both are work, and both
    // would vanish from a naive `status === 'open'` count.
    const openCases = database.cases.filter(
      (entry) => !['resolved', 'dismissed', 'closed'].includes(entry.status),
    );

    const now = Date.now();
    const weekAway = new Date(now + 7 * 86_400_000).toISOString();
    const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
    const monthAgo = new Date(now - 30 * 86_400_000).toISOString();

    return {
      pendingReviews: queue(
        database.reviews.filter((review) => review.status === 'pending_moderation'),
        (review) => review.createdAt,
      ),
      openReports: queue(
        database.reports.filter((report) => report.status === 'open'),
        (report) => report.createdAt,
      ),
      openFlags: queue(flags, (entry) => entry.flag.createdAt),
      pendingVerifications: queue(
        database.verifications.filter((record) => record.outcome === 'pending'),
        (record) => record.createdAt,
      ),
      pendingClaims: queue(
        database.claims.filter((claim) => claim.status === 'pending'),
        (claim) => claim.createdAt,
      ),

      cases: {
        open: openCases.length,
        unassigned: openCases.filter((entry) => !entry.assignedTo).length,
        mine: viewerId ? openCases.filter((entry) => entry.assignedTo === viewerId).length : 0,
        critical: openCases.filter((entry) => entry.priority === 'critical').length,
        oldest:
          openCases.length === 0
            ? null
            : openCases.map((entry) => entry.createdAt).sort()[0] ?? null,
      },

      trustAndSafety: privileged
        ? {
            openAuthorityRequests: database.authorityRequests.filter(
              (request) => !['fulfilled', 'declined', 'closed'].includes(request.status),
            ).length,
            preservationHolds: database.cases.filter((entry) => entry.preservationHold).length,
            sanctionsExpiring: database.sanctions.filter(
              (sanction) =>
                !sanction.liftedAt &&
                sanction.endsAt !== null &&
                sanction.endsAt >= new Date(now).toISOString() &&
                sanction.endsAt <= weekAway,
            ).length,
            refusalsLast7Days: database.adminAudit.filter(
              (entry) => entry.outcome === 'denied' && entry.createdAt >= weekAgo,
            ).length,
          }
        : null,

      platform: {
        properties: database.properties.filter((property) => property.status === 'active').length,
        reviews: database.reviews.filter((review) => review.status === 'published').length,
        users: database.users.length,
        reviewsLast30Days: database.reviews.filter((review) => review.createdAt >= monthAgo)
          .length,
      },
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
    reason: string,
  ): Promise<void> {
    if (!reason || reason.trim().length < 3) {
      throw new Error('A reason is required, for the audit trail');
    }

    await mutate((database) => {
      const claim = database.claims.find((c) => c.id === claimId);
      if (!claim) throw new Error('Claim not found');

      if (claim.status !== 'pending') {
        throw new Error('That claim has already been decided');
      }

      // One approved claim per property — a unique index in Postgres, and the
      // same rule here.
      //
      // This used to revoke the other claim silently as a side effect of
      // approving this one. Taking a commercial party's access to a property
      // page away is a decision with consequences, and it now needs its own
      // act and its own reason rather than happening quietly inside somebody
      // else's approval.
      if (status === 'approved') {
        const held = database.claims.find(
          (other) =>
            other.propertyId === claim.propertyId &&
            other.id !== claim.id &&
            other.status === 'approved',
        );

        if (held) {
          throw new Error(
            'Another claim on this property is already approved. Revoke it first.',
          );
        }
      }

      claim.status = status;
      claim.reviewedBy = actorId;
      claim.decidedAt = nowIso();

      database.moderationActions.push({
        id: trailId(database),
        actorId,
        actorRole: database.users.find((u) => u.id === actorId)?.role ?? null,
        subjectType: 'claim',
        subjectId: claimId,
        action: `claim_${status}`,
        reason: reason.trim(),
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

  async findApprovedClaimantId(propertyId: string): Promise<string | null> {
    const database = await getDatabase();
    const claim = database.claims.find(
      (candidate) => candidate.propertyId === propertyId && candidate.status === 'approved',
    );
    return claim?.claimantId ?? null;
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
   * Notifications
   *
   * The ledger is the same shape as `notification_events` in Postgres, and
   * the claim is the same rule: the first caller to present a dedupe key owns
   * the send and every later one is told no. Here that is enforced by
   * `mutate`, which serialises writes through a promise chain, so the
   * read-modify-write cannot interleave. There it is a unique index.
   *
   * Addresses are on the user record in this store, so there is no
   * service-role boundary to cross; the method exists to keep the two
   * adapters interchangeable, and it applies the same two refusals — an
   * unknown account, and a banned one.
   * ------------------------------------------------------------------ */

  async claimNotification(input: {
    dedupeKey: string;
    kind: string;
    recipientId: string | null;
    recipientKind: 'user' | 'moderator' | 'trust_admin' | 'admin';
    payload: Record<string, unknown>;
  }): Promise<boolean> {
    return mutate((database) => {
      if (database.notifications.some((entry) => entry.dedupeKey === input.dedupeKey)) {
        return false;
      }

      database.notifications.push({
        id: `notif-${shortId(12)}`,
        dedupeKey: input.dedupeKey,
        kind: input.kind,
        recipientId: input.recipientId,
        recipientKind: input.recipientKind,
        status: 'pending',
        detail: null,
        attempts: 1,
        payload: input.payload,
        createdAt: nowIso(),
        sentAt: null,
      });

      return true;
    });
  }

  async settleNotification(
    dedupeKey: string,
    status: 'sent' | 'failed' | 'skipped',
    detail: string | null,
  ): Promise<void> {
    await mutate((database) => {
      const entry = database.notifications.find((row) => row.dedupeKey === dedupeKey);
      if (!entry) return;
      entry.status = status;
      entry.detail = detail ? detail.slice(0, 500) : null;
      if (status === 'sent') entry.sentAt = nowIso();
    });
  }

  async notificationRecipient(userId: string): Promise<NotificationRecipient | null> {
    const database = await getDatabase();
    const user = database.users.find((candidate) => candidate.id === userId);
    if (!user || user.status === 'banned') return null;

    return {
      userId: user.id,
      email: user.email,
      locale: user.preferredLocale,
      preferences: preferencesOf(user),
    };
  }

  async notificationStaff(minRole: AdminRole): Promise<NotificationRecipient[]> {
    const database = await getDatabase();
    const wanted = STAFF_RANK[minRole] ?? 1;

    return database.users
      .filter((user) => user.status === 'active' && (STAFF_RANK[user.role as AdminRole] ?? 0) >= wanted)
      .slice(0, 50)
      .map((user) => ({
        userId: user.id,
        email: user.email,
        locale: user.preferredLocale,
        preferences: preferencesOf(user),
      }));
  }

  async getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
    const database = await getDatabase();
    const user = database.users.find((candidate) => candidate.id === userId);
    return preferencesOf(user);
  }

  async setNotificationPreferences(
    userId: string,
    preferences: NotificationPreferences,
  ): Promise<void> {
    await mutate((database) => {
      const user = database.users.find((candidate) => candidate.id === userId);
      if (!user) return;
      user.notificationPreferences = { ...preferences };
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
        caseId: report.caseId,
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
        id: trailId(database),
        actorId,
        actorRole: database.users.find((u) => u.id === actorId)?.role ?? null,
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
        id: trailId(database),
        actorId,
        actorRole: database.users.find((u) => u.id === actorId)?.role ?? null,
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

/* -------------------------------------------------------------------------
 * Notification helpers
 * ---------------------------------------------------------------------- */

/** The ladder in src/server/auth/guards.ts, as a lookup. */
const STAFF_RANK: Record<string, number> = {
  moderator: 1,
  trust_admin: 2,
  admin: 3,
};

/** Defaults on, matching the column defaults in migration 0044. */
function preferencesOf(user: StoredUser | undefined): NotificationPreferences {
  return {
    reviewUpdates: user?.notificationPreferences?.reviewUpdates ?? true,
    propertyResponses: user?.notificationPreferences?.propertyResponses ?? true,
    trustSafety: user?.notificationPreferences?.trustSafety ?? true,
  };
}

/** Kept for the address formatter's use in tests and future exports. */
export { formatAddressInline };
