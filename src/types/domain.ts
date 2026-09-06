/**
 * Livd domain types.
 *
 * These describe the product's concepts, not any particular storage engine.
 * Both the local and Supabase repository adapters map onto exactly these shapes,
 * which is what keeps the two interchangeable.
 */

/* -------------------------------------------------------------------------
 * Location & money
 * ---------------------------------------------------------------------- */

/** ISO 3166-1 alpha-2. */
export type CountryCode = string;

/** ISO 4217. */
export type CurrencyCode = string;

/**
 * A property's address, decomposed rather than formatted.
 *
 * Only `locality` and `countryCode` are guaranteed. Address structure genuinely
 * differs by country, so everything else is optional and rendering is driven by
 * a per-country template in `src/config/markets.ts`.
 *
 * There is no `unit` field. Unit-level identification is never part of a
 * property's public identity.
 */
export interface PropertyAddress {
  buildingName: string | null;
  streetAddress: string | null;
  neighbourhood: string | null;
  locality: string;
  adminArea: string | null;
  postalCode: string | null;
  countryCode: CountryCode;
}

/**
 * Money is always a pair. There is no ambient currency in this application.
 * Amounts are in the currency's minor unit (cents, kobo, pence).
 */
export interface Money {
  amountMinor: number;
  currencyCode: CurrencyCode;
}

export type RentPeriod = 'month' | 'year';

/* -------------------------------------------------------------------------
 * Property
 * ---------------------------------------------------------------------- */

export type PropertyTypeKey =
  | 'apartment'
  | 'house'
  | 'townhouse'
  | 'duplex'
  | 'studio'
  | 'shared'
  | 'room'
  | 'bungalow'
  | 'building';

export type PropertyStatus = 'active' | 'pending_review' | 'merged' | 'removed';

export interface Property {
  id: string;
  slug: string;
  address: PropertyAddress;
  propertyType: PropertyTypeKey;
  /** Rounded to 3 decimal places (~110m) before storage. Never unit-precise. */
  coordinates: { latitude: number; longitude: number } | null;
  unitCount: number | null;
  yearBuilt: number | null;
  status: PropertyStatus;
  mergedInto: string | null;
  /** Seeded sample data. Labelled as such everywhere it is rendered. */
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------
 * Reviews
 * ---------------------------------------------------------------------- */

export type ResidencyStatus = 'current' | 'former';

export type VerificationLevel = 'unverified' | 'verified_resident' | 'disputed';

export type ReviewStatus =
  | 'published'
  | 'pending_moderation'
  | 'held'
  | 'removed';

export interface CategoryRating {
  categoryKey: string;
  /** 1–5, as given by the resident. Converted to 0–100 only for display. */
  rating: number;
}

export interface Review {
  id: string;
  propertyId: string;
  authorId: string;
  residencyStatus: ResidencyStatus;
  /** ISO date pinned to the first of the month. Never an exact date. */
  movedInMonth: string;
  movedOutMonth: string | null;
  tenureMonths: number;
  overallRating: number;
  body: string | null;
  wouldRecommend: boolean;
  rent: Money | null;
  rentPeriod: RentPeriod | null;
  categoryRatings: CategoryRating[];
  /** Structured "what was good" / "what was difficult" chips. */
  positiveTags: string[];
  problemTags: string[];
  /** Former residents only. */
  primaryDepartureReason: string | null;
  secondaryDepartureReasons: string[];
  /**
   * Whether the resident saw the landlord or managing agent change during their
   * tenancy. Cheap to ask, and the only honest way to build a timeline entry
   * about a change of management rather than inferring one.
   */
  noticedManagementChange: boolean | null;
  verificationLevel: VerificationLevel;
  status: ReviewStatus;
  safetyFlags: string[];
  helpfulCount: number;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A review as the public sees it.
 *
 * Constructed by the repository, never by a component. There is no author
 * identifier of any kind on this shape — that is the point of it.
 */
export interface PublicReview {
  id: string;
  propertyId: string;
  residencyStatus: ResidencyStatus;
  verificationLevel: VerificationLevel;
  /** e.g. "Verified former resident" */
  attribution: string;
  /** e.g. "Lived here 2 years · left 2024" */
  tenureLabel: string;
  tenureMonths: number;
  overallRating: number;
  body: string | null;
  wouldRecommend: boolean;
  categoryRatings: CategoryRating[];
  positiveTags: string[];
  problemTags: string[];
  primaryDepartureReason: string | null;
  rent: Money | null;
  rentPeriod: RentPeriod | null;
  helpfulCount: number;
  isDemo: boolean;
  createdAt: string;
  ownerResponse: OwnerResponse | null;
}

export interface OwnerResponse {
  id: string;
  reviewId: string;
  body: string;
  /** Marks a response that reports an issue as resolved. */
  isResolutionNotice: boolean;
  respondentRole: 'owner' | 'manager' | 'agent';
  createdAt: string;
}

/* -------------------------------------------------------------------------
 * Intelligence
 * ---------------------------------------------------------------------- */

/**
 * How much a score can be relied upon. Livd never shows a number without one.
 * Below `limited`, no score is displayed at all.
 */
export type ConfidenceBand = 'insufficient' | 'limited' | 'moderate' | 'strong';

export interface CategoryScore {
  categoryKey: string;
  /** 0–100. Null when too few residents rated this category. */
  score: number | null;
  /** Number of reviews that rated this category. */
  sampleSize: number;
  confidence: ConfidenceBand;
}

export type TrendDirection = 'improving' | 'stable' | 'declining' | 'unknown';

export interface ScoreTrend {
  direction: TrendDirection;
  /** Change in score points between the earlier and later window. */
  delta: number | null;
  earlierWindow: { label: string; score: number; sampleSize: number } | null;
  laterWindow: { label: string; score: number; sampleSize: number } | null;
}

export interface DepartureReasonShare {
  reasonKey: string;
  count: number;
  /** 0–1. */
  share: number;
}

export interface DepartureBreakdown {
  /** Former residents who gave a reason. */
  respondents: number;
  /** Empty when below the disclosure threshold. */
  reasons: DepartureReasonShare[];
  /** True when there is not yet enough data to publish a distribution. */
  suppressed: boolean;
}

export interface TagFrequency {
  tagKey: string;
  count: number;
  share: number;
}

export interface TimelineEntry {
  /** Calendar year the entry describes. */
  year: number;
  kind: 'score_shift' | 'management_change' | 'rent_change' | 'volume';
  /** Composed from aggregates only — never invented. */
  summary: string;
  sampleSize: number;
}

/**
 * The complete intelligence read for one property.
 * Computed on the server from published reviews and cached with the page.
 */
export interface PropertyIntelligence {
  propertyId: string;
  reviewCount: number;
  verifiedReviewCount: number;
  /** 0–100. Null when confidence is `insufficient`. */
  overallScore: number | null;
  confidence: ConfidenceBand;
  /** Sum of per-review weights — the basis for the confidence band. */
  effectiveSampleSize: number;
  /** 0–1. Null below the disclosure threshold. */
  recommendRate: number | null;
  categoryScores: CategoryScore[];
  departures: DepartureBreakdown;
  topPositiveTags: TagFrequency[];
  topProblemTags: TagFrequency[];
  trend: ScoreTrend;
  timeline: TimelineEntry[];
  currentResidentCount: number;
  formerResidentCount: number;
  lastReviewAt: string | null;
  /** Median reported rent, when enough residents reported one. */
  reportedRent: { median: Money; period: RentPeriod; sampleSize: number } | null;
}

/** A property joined with its intelligence — what list and card views consume. */
export interface PropertySummary {
  property: Property;
  intelligence: PropertyIntelligence;
}

/* -------------------------------------------------------------------------
 * Verdict & guidance
 * ---------------------------------------------------------------------- */

export interface ResidentVerdict {
  /** One or two sentences assembled from aggregates. */
  summary: string;
  strengths: string[];
  concerns: string[];
  /** Every claim carries the count it was derived from. */
  basis: { reviewCount: number; confidence: ConfidenceBand };
}

export interface PreVisitCheck {
  categoryKey: string | null;
  /** A question the renter can ask verbatim. */
  question: string;
  reason: string;
}

/* -------------------------------------------------------------------------
 * People, safety & personalisation
 * ---------------------------------------------------------------------- */

export type UserRole = 'resident' | 'owner' | 'moderator' | 'admin';

export type UserStatus = 'active' | 'restricted' | 'suspended';

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  countryCode: CountryCode | null;
  preferredLocale: string;
  createdAt: string;
}

export type ReportReason =
  | 'inappropriate'
  | 'false_information'
  | 'privacy'
  | 'spam'
  | 'harassment'
  | 'not_a_resident'
  | 'other';

export type ReportStatus = 'open' | 'under_review' | 'upheld' | 'dismissed';

export interface ReviewReport {
  id: string;
  reviewId: string;
  reporterId: string;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export type ClaimStatus = 'pending' | 'approved' | 'rejected' | 'revoked';

export interface PropertyClaim {
  id: string;
  propertyId: string;
  claimantId: string;
  roleClaimed: 'owner' | 'manager' | 'agent';
  organisation: string | null;
  contactEmail: string;
  status: ClaimStatus;
  reviewedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/* -------------------------------------------------------------------------
 * Automated trust-and-safety signals
 * ---------------------------------------------------------------------- */

export type PropertyFlagKind = 'review_burst' | 'rating_anomaly' | 'new_account_concentration';

export type PropertyFlagStatus = 'open' | 'reviewed' | 'dismissed';

/**
 * Something the burst detector noticed, waiting for a person to decide about it.
 *
 * A flag is never acted on automatically. A property written about by twenty
 * delighted residents looks identical, from the outside, to one being
 * astroturfed; telling those apart is a judgement, and `observed` carries the
 * arithmetic so a moderator can make it rather than be handed a verdict.
 */
export interface PropertyFlag {
  id: string;
  propertyId: string;
  kind: PropertyFlagKind;
  /** 1 unusual · 2 hard to explain innocently · 3 look at this today. */
  severity: 1 | 2 | 3;
  windowStart: string;
  windowEnd: string;
  /** The numbers behind the flag. Shape depends on `kind`. */
  observed: Record<string, number | string | null>;
  detail: string;
  status: PropertyFlagStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface ModerationAction {
  id: string;
  actorId: string;
  subjectType: 'review' | 'property' | 'user' | 'claim' | 'owner_response';
  subjectId: string;
  action: string;
  reason: string | null;
  previousStatus: string | null;
  newStatus: string | null;
  createdAt: string;
}

export interface SavedProperty {
  userId: string;
  propertyId: string;
  note: string | null;
  createdAt: string;
}

/* -------------------------------------------------------------------------
 * Search
 * ---------------------------------------------------------------------- */

export interface SearchSuggestion {
  kind: 'property' | 'locality' | 'neighbourhood';
  label: string;
  sublabel: string;
  href: string;
  reviewCount: number | null;
}

export type SearchSort =
  | 'relevance'
  | 'score_desc'
  | 'score_asc'
  | 'reviews_desc'
  | 'recent';

export interface SearchFilters {
  query: string;
  countryCode: CountryCode | null;
  locality: string | null;
  propertyTypes: PropertyTypeKey[];
  minScore: number | null;
  minReviews: number | null;
  verifiedOnly: boolean;
  sort: SearchSort;
  page: number;
}

export interface SearchResults {
  items: PropertySummary[];
  total: number;
  page: number;
  pageSize: number;
  /** Set when the query was matched fuzzily, so the UI can say so. */
  correctedFrom: string | null;
}
