/**
 * Livd domain types.
 *
 * These describe the product's concepts, not any particular storage engine.
 * Both the local and Supabase repository adapters map onto exactly these shapes,
 * which is what keeps the two interchangeable.
 */

import type { ResidentRecency } from '@/config/verification';

export type { ResidentRecency };

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

/**
 * How much Livd has been able to establish about a review's author.
 *
 * Ordered by strength, and deliberately not a boolean:
 *
 *   `unverified`        Nothing was checked. Every review written before the
 *                       verification system existed is here, and so is every
 *                       review whose author chose not to verify. Neither is
 *                       labelled as verified anywhere, and neither is penalised.
 *   `location_verified` The author was at the property when they wrote. Real
 *                       evidence of presence; not evidence of a tenancy, and
 *                       never described as such.
 *   `verified_resident` A moderator read a document tying this person to this
 *                       address.
 *   `disputed`          Authenticity is contested. Contributes nothing to the
 *                       score until it is resolved.
 *
 * Set by the server alone. A client cannot assert one: the database derives it
 * on insert from the verification record the review points at, and refuses any
 * value the client supplies.
 */
export type VerificationLevel =
  | 'unverified'
  | 'location_verified'
  | 'verified_resident'
  | 'disputed';

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
  /**
   * Null once the author has deleted their account.
   *
   * The review itself survives — every legal page promises that a published
   * review stays as part of the property record — and becomes permanently
   * unattributable. Nothing can re-link it: the update guard forbids changing
   * the column and the insert policy requires it to equal the caller, which no
   * null can satisfy.
   */
  authorId: string | null;
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
  /**
   * The property verification this review's level was derived from, if any.
   *
   * Server-set and immutable. It is what ties a verification to *this* property
   * and *this* author: the database refuses an insert whose verification names
   * a different property or a different person, so a check passed at one
   * address cannot be carried to a review of another.
   */
  verificationId: string | null;
  /** When that verification happened. Never rendered more precisely than a relative time. */
  verifiedAt: string | null;
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
  /**
   * How current this experience is — derived on read, never stored.
   *
   * Note what is *not* here: no verification timestamp, no coordinates, no
   * distance, no accuracy. A reader needs to know an experience is recent and
   * was checked. Nothing else about the check is theirs to know.
   */
  recency: ResidentRecency;
  /** e.g. "Verified former resident" */
  attribution: string;
  /** e.g. "Current resident · Location verified" — the full trust line. */
  trustLabel: string;
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

/**
 * How representative a property's evidence is of living there *today*.
 *
 * Counts only. Nothing here is a score and nothing here feeds the Livd Score —
 * freshness is context a reader applies for themselves.
 */
export interface ResidentFreshness {
  current: number;
  recent: number;
  former: number;
  older: number;
  /** Reviews written inside the activity window, whatever their verification. */
  reviewsInActivityWindow: number;
  /** Reviews carrying either level of verification. */
  verifiedCount: number;
  locationVerifiedCount: number;
  residentVerifiedCount: number;
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
  /**
   * How representative this property's evidence is of living there today.
   *
   * Counts, not a score. Nothing here feeds the Livd Score — freshness is
   * context a reader applies for themselves, not a second number competing
   * with the one they came for.
   */
  freshness: ResidentFreshness;
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

/**
 * What an account may do.
 *
 * Two of these are not privileges at all. `resident` is the default, and
 * `owner` describes a relationship to a building — someone who has claimed a
 * property — which grants a right of reply and nothing whatsoever about the
 * people who reviewed it. Neither sits on the administrative ladder.
 *
 * The other three do, in order:
 *
 *   `moderator`   Reads reported content, moderates reviews, works cases.
 *                 Sees a masked email and never the address behind it.
 *   `trust_admin` May additionally reveal an account identity and read
 *                 verification evidence — the identity boundary. Every
 *                 crossing of it is audited.
 *   `admin`       May additionally grant roles and change security
 *                 configuration.
 *
 * The database knows this hierarchy too, through `livd_is_moderator`,
 * `livd_is_trust_admin` and `livd_is_super_admin`. It is not a fact that lives
 * only in TypeScript, because a fact that lives only in TypeScript is one a
 * request to PostgREST does not have to respect.
 */
export type UserRole = 'resident' | 'owner' | 'moderator' | 'trust_admin' | 'admin';

/** The three administrative tiers. `resident` and `owner` are deliberately absent. */
export type AdminRole = Extract<UserRole, 'moderator' | 'trust_admin' | 'admin'>;

/**
 * An account's standing.
 *
 * Entirely separate from what has happened to anything the account wrote. A
 * banned account keeps its published reviews; a removed review says nothing
 * about its author's standing. Conflating the two is how moderation systems
 * end up punishing people twice for one thing, or not at all for another.
 */
export type UserStatus = 'active' | 'restricted' | 'suspended' | 'banned';

/** The three standings that are a sanction. `active` is the absence of one. */
export type SanctionAction = Exclude<UserStatus, 'active'>;

/**
 * An account, as the account holder's own session sees it.
 *
 * `email` is the signed-in person's own address and is populated only when
 * that is who is being read. It is not, and must never become, a way for one
 * person to learn another's — administrative screens use `AdminUserSummary`,
 * which has no such field.
 */
export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  countryCode: CountryCode | null;
  preferredLocale: string;
  createdAt: string;
}

/**
 * An account as an administrative screen sees it.
 *
 * Note what is missing. There is no `email`, only a `maskedEmail`, and the
 * masking happens in Postgres before the row is returned — so no object in
 * this process carries the real address, and none can leak into a payload, a
 * log or an error message.
 *
 * That is the difference between this type and `UserProfile`, and it is the
 * whole point of having two. Reading an actual address is a separate operation
 * with its own authorisation and its own audit record; it is never a side
 * effect of listing people.
 */
export interface AdminUserSummary {
  id: string;
  /** e.g. `fer***@gmail.com`. Never the address itself. */
  maskedEmail: string;
  role: UserRole;
  status: UserStatus;
  countryCode: CountryCode | null;
  createdAt: string;
  reviewCount: number;
  verifiedReviewCount: number;
  /** Reports made about what this account wrote. Not a verdict on anything. */
  reportsAgainst: number;
  lastReviewAt: string | null;
}

/**
 * How a directory listing was narrowed.
 *
 * `search` is either an id prefix or an email address, and which one it is
 * decides who may run it: an internal identifier means nothing outside Livd,
 * but typing an address into a box and getting a result confirms that address
 * holds an account here. That is a disclosure — small, and exactly the kind a
 * property owner's lawyer would go looking for — so it needs Trust & Safety
 * authorisation. The database decides, by looking for an `@`.
 */
export interface AdminUserFilters {
  page?: number;
  pageSize?: number;
  search?: string | null;
  role?: UserRole | null;
  status?: UserStatus | null;
  /** True: has at least one verified review. False: has none. Null: either. */
  hasVerifiedReviews?: boolean | null;
  /** True: something they wrote has been reported. Null: either. */
  hasReports?: boolean | null;
  joinedAfter?: string | null;
  minReviews?: number | null;
}

/** One page of the administrative user directory. */
export interface AdminUserPage {
  items: AdminUserSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * One account, in as much detail as a moderator is entitled to.
 *
 * Still masked. Everything here is either the account's own standing or a
 * count of its activity — nothing that identifies the person. Revealing the
 * address is a separate operation with its own authorisation and its own audit
 * entry, and this type has no field for the result.
 */
export interface AdminUserDetail {
  id: string;
  maskedEmail: string;
  role: UserRole;
  status: UserStatus;
  countryCode: CountryCode | null;
  preferredLocale: string;
  createdAt: string;
  reviewCount: number;
  publishedReviewCount: number;
  removedReviewCount: number;
  heldReviewCount: number;
  verifiedReviewCount: number;
  reportsAgainst: number;
  reportsMade: number;
  /** How many location checks this account has attempted. Never where. */
  locationCheckCount: number;
  residencySubmissions: number;
  lastReviewAt: string | null;
}

/** One review by the account being investigated, with what happened to it. */
export interface AdminUserReview {
  reviewId: string;
  propertyId: string;
  propertySlug: string;
  address: PropertyAddress;
  overallRating: number;
  residencyStatus: ResidencyStatus;
  verificationLevel: VerificationLevel;
  status: ReviewStatus;
  createdAt: string;
  reportCount: number;
}

/**
 * One report about something the account wrote.
 *
 * The reporter is an id and nothing more. A moderator needs to see that the
 * same account filed nine of these; they do not need to know whose account it
 * is, and nothing here tells them.
 */
export interface AdminUserReport {
  reportId: string;
  reviewId: string;
  reporterId: string | null;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  resolution: string | null;
  /**
   * The Trust & Safety case this report belongs to, once one has been opened.
   *
   * Null is the ordinary state, not a broken one: a report is a report whether
   * or not anybody has escalated it into an investigation, and every report
   * written before cases existed still reads correctly.
   */
  caseId: string | null;
  createdAt: string;
  resolvedAt: string | null;
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
  /** Null once the reporter has deleted their account. The report is kept. */
  reporterId: string | null;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  resolution: string | null;
  /**
   * The Trust & Safety case this report belongs to, once one is opened.
   *
   * Null is the ordinary state rather than a broken one: a report is a report
   * whether or not anybody escalated it into an investigation, and every report
   * written before cases existed still reads correctly.
   */
  caseId: string | null;
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
 * Residency verification
 * ---------------------------------------------------------------------- */

export type VerificationCheckCode =
  | 'evidence_reused_by_another_account'
  | 'evidence_already_submitted'
  | 'submitter_owns_the_property'
  | 'tenancy_predates_the_building'
  | 'tenancy_in_the_future'
  | 'account_created_after_move_out'
  | 'many_recent_submissions'
  | 'unsupported_file_type'
  | 'file_too_large'
  | 'file_empty';

/** `blocking` refuses the submission. `note` travels with it to a moderator. */
export type VerificationCheckSeverity = 'blocking' | 'note';

export interface VerificationCheck {
  code: VerificationCheckCode;
  severity: VerificationCheckSeverity;
  /** One sentence, written for the moderator who will read it. */
  detail: string;
}

export type VerificationOutcome = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export type VerificationMethod =
  | 'tenancy_agreement'
  | 'utility_bill'
  | 'correspondence'
  | 'other';

/**
 * One request to be recognised as a former or current resident.
 *
 * Note what is absent: the object key of the uploaded document. It stays
 * inside the data adapter so that no route, component or log can render it by
 * accident. The evidence reaches a moderator only through a signed URL minted
 * per view, and reaches nobody else at all.
 */
export interface VerificationRecord {
  id: string;
  subjectType: 'review' | 'claim' | 'user';
  subjectId: string;
  submittedBy: string | null;
  method: VerificationMethod;
  outcome: VerificationOutcome;
  /** What the automated checks found. Advisory; nothing here decided anything. */
  checks: VerificationCheck[];
  evidenceMime: string | null;
  evidenceBytes: number | null;
  notes: string | null;
  reviewedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/* -------------------------------------------------------------------------
 * Property verification
 * ---------------------------------------------------------------------- */

/**
 * How a property verification was established.
 *
 * A union rather than a boolean because the architecture has to hold more than
 * one answer. `location` is the only method implemented; the others are the
 * shapes the model is built to accept — a lease, a utility account, a landlord
 * or an existing resident vouching — and each would produce the same kind of
 * record with a different level attached.
 */
export type PropertyVerificationMethod =
  | 'location'
  | 'lease'
  | 'utility'
  | 'landlord'
  | 'invitation';

export type PropertyVerificationStatus = 'verified' | 'failed';

/**
 * Why an attempt did not succeed. Coarse on purpose: a reason code carries no
 * distance, so refusals cannot be used to search for a property's true
 * position, and a moderator reading the trail learns what went wrong without
 * learning where anyone was.
 */
export type PropertyVerificationFailureReason =
  | 'property_has_no_coordinates'
  | 'invalid_position'
  | 'accuracy_too_low'
  | 'fix_too_old'
  | 'outside_area'
  | 'implausible_movement';

/**
 * One verification attempt, successful or not.
 *
 * This is the audit trail, and its most important property is what it does not
 * contain: no latitude, no longitude, no accuracy, no distance, no IP address,
 * no device string. Coordinates reach the server as arguments to a decision and
 * are gone when it returns. What survives is the fact that a decision was made,
 * about whom, about which property, by what method, and when.
 */
export interface PropertyVerification {
  id: string;
  userId: string;
  propertyId: string;
  method: PropertyVerificationMethod;
  status: PropertyVerificationStatus;
  /** Null when the attempt succeeded. */
  failureReason: PropertyVerificationFailureReason | null;
  /** After this, the verification can no longer be attached to a new review. */
  expiresAt: string;
  createdAt: string;
}

/** What the review wizard needs to know about the caller's standing at a property. */
export interface VerificationStanding {
  /** False when the property has no coordinates, so the step is not offered. */
  canVerifyLocation: boolean;
  /** A live, unexpired verification this person may attach to a review. */
  activeVerification: PropertyVerification | null;
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
  /**
   * Null once the moderator has deleted their account.
   *
   * The decision outlives the person who made it. A moderation history with
   * holes in it is not a history, so the row is severed rather than removed.
   */
  actorId: string | null;
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

/* -------------------------------------------------------------------------
 * Trust & Safety cases
 * ---------------------------------------------------------------------- */

/**
 * Where a case is.
 *
 * Nine, which is more than most systems need and fewer than most systems have.
 * The three at the end are all conclusions and are genuinely different:
 * `resolved` means something was wrong and was dealt with, `dismissed` means
 * nothing was wrong, and `closed` means filed. Collapsing them would lose the
 * only distinction anybody reads a case history for.
 */
export type CaseStatus =
  | 'new'
  | 'open'
  | 'investigating'
  | 'awaiting_information'
  | 'action_taken'
  | 'escalated'
  | 'resolved'
  | 'dismissed'
  | 'closed';

/**
 * How urgently this needs a person.
 *
 * `critical` is never set by a machine, and raising a case to it requires
 * Trust & Safety authorisation. A keyword is not a threat, and a system that
 * lets one reach the top of the queue is a system anybody can steer by
 * choosing their words.
 */
export type CasePriority = 'low' | 'medium' | 'high' | 'critical';

export interface CaseCategory {
  key: string;
  label: string;
  description: string;
  defaultPriority: CasePriority;
}

/** One case, as a list row. */
export interface CaseSummary {
  id: string;
  /** `LV-1048`. Stable and human — what somebody quotes in a note or an email. */
  reference: string;
  status: CaseStatus;
  priority: CasePriority;
  category: string;
  summary: string;
  /** What was decided. Required before a case may be concluded. */
  outcome: string | null;
  assignedTo: string | null;
  openedBy: string | null;
  subjectReviewId: string | null;
  subjectUserId: string | null;
  subjectPropertyId: string | null;
  /** Present when the case names a property. */
  property: { slug: string; address: PropertyAddress } | null;
  reportCount: number;
  noteCount: number;
  /** While true, nothing belonging to this case is eligible for routine deletion. */
  preservationHold: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface CasePage {
  items: CaseSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * One timeline entry.
 *
 * Written in the same transaction as the change it describes, so a status that
 * moved without an event is not a state the database can reach. `kind` is text
 * rather than an enum for the same reason the audit log's is: a timeline write
 * must never fail because somebody added an event type and forgot a migration.
 */
export interface CaseEvent {
  id: string;
  actorId: string | null;
  kind: string;
  summary: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

/** An internal note. Never shown to a reviewer, reporter, owner or the public. */
export interface CaseNote {
  id: string;
  authorId: string | null;
  body: string;
  createdAt: string;
}

export interface CaseFilters {
  page?: number;
  pageSize?: number;
  status?: CaseStatus | null;
  priority?: CasePriority | null;
  category?: string | null;
  assignedTo?: string | null;
  unassignedOnly?: boolean;
  openOnly?: boolean;
  reference?: string | null;
}


/* -------------------------------------------------------------------------
 * Review investigation
 * ---------------------------------------------------------------------- */

/**
 * Everything an investigation needs about one review.
 *
 * The privacy shape is the point. Every field here is INTERNAL: an account id,
 * counts, statuses, decisions — enough to decide whether a review should stay
 * up, and nothing that identifies who wrote it. The address and the residency
 * document are RESTRICTED and are not on this type at all; reaching either is a
 * separate operation with its own authorisation and its own audit entry.
 *
 * `authorId` is null for a review whose author deleted their account. The
 * review stays on the property page, permanently unattributable, which is what
 * every legal page promises — and the investigation view still has to work.
 */
export interface ReviewInvestigation {
  reviewId: string;
  body: string | null;
  overallRating: number;
  wouldRecommend: boolean;
  residencyStatus: ResidencyStatus;
  movedInMonth: string;
  movedOutMonth: string | null;
  tenureMonths: number;
  verificationLevel: VerificationLevel;
  verifiedAt: string | null;
  status: ReviewStatus;
  safetyFlags: string[];
  helpfulCount: number;
  createdAt: string;
  updatedAt: string;

  author: {
    id: string;
    status: UserStatus;
    createdAt: string;
    reviewCount: number;
    removedReviewCount: number;
    reportsAgainst: number;
    verifiedReviewCount: number;
  } | null;

  property: {
    id: string;
    slug: string;
    address: PropertyAddress;
    reviewCount: number;
    reportedReviewCount: number;
    verifiedReviewCount: number;
    recentReviewCount: number;
    isClaimed: boolean;
  };

  reportCount: number;
  openReportCount: number;
  caseCount: number;
}

/**
 * One thing that was checked about a review's author.
 *
 * A verdict, a method and a time. There is no position on this type because
 * there is none in the database — `property_verifications` has never stored a
 * coordinate, an accuracy or a distance.
 */
export interface ReviewVerificationEntry {
  kind: 'location' | 'residency';
  id: string;
  method: string;
  outcome: string;
  failureReason: string | null;
  /** Whether this check concerned the property under investigation. */
  atThisProperty: boolean;
  createdAt: string;
  decidedAt: string | null;
  /** Residency only. The document itself is reached separately, and audited. */
  hasEvidence: boolean;
}

/** One report about the review being investigated. */
export interface ReviewReportEntry {
  reportId: string;
  /** An id and nothing more. Who it belongs to is a separate question. */
  reporterId: string | null;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  resolution: string | null;
  caseId: string | null;
  caseReference: string | null;
  createdAt: string;
  resolvedAt: string | null;
}


/* -------------------------------------------------------------------------
 * Evidence
 * ---------------------------------------------------------------------- */

/**
 * What a review said before it was changed.
 *
 * Written by a database trigger rather than by the moderation path, so
 * preservation is not something an action can forget to do — it does not happen
 * on that path at all. The oldest snapshot a review has is the state it was
 * published in.
 *
 * Holds the content and not its author. A snapshot identifies nobody.
 */
export interface ReviewSnapshot {
  id: string;
  reason: 'moderation' | 'correction' | 'verification' | 'other';
  body: string | null;
  overallRating: number | null;
  wouldRecommend: boolean | null;
  verificationLevel: VerificationLevel | null;
  status: ReviewStatus | null;
  safetyFlags: string[];
  categoryRatings: CategoryRating[];
  positiveTags: string[];
  problemTags: string[];
  /** Null when the change came from the service role rather than a session. */
  changedBy: string | null;
  createdAt: string;
}

/**
 * One item of evidence on a case.
 *
 * Note what is absent: the storage key. A row says a file exists, what type it
 * is and how big; opening it is a separate operation. A key in a payload is a
 * key in a browser's memory, a screenshot and a support ticket.
 */
export interface CaseEvidenceItem {
  id: string;
  kind: 'file' | 'link' | 'note' | 'review_snapshot';
  title: string;
  description: string | null;
  mime: string | null;
  bytes: number | null;
  hasFile: boolean;
  snapshotId: string | null;
  version: number;
  supersedes: string | null;
  /** True when a later version replaced this one. Both remain readable. */
  superseded: boolean;
  addedBy: string | null;
  withdrawnAt: string | null;
  withdrawnBy: string | null;
  withdrawnReason: string | null;
  createdAt: string;
}


/* -------------------------------------------------------------------------
 * Sanctions
 * ---------------------------------------------------------------------- */

export interface SanctionReason {
  key: string;
  label: string;
  description: string;
  /** The lightest sanction this reason usually warrants. A default, not a rule. */
  suggestedAction: SanctionAction;
}

/**
 * One sanction.
 *
 * Everything a person reviewing the decision six months later needs: what was
 * done, under which category, in whose words, by whom, for how long, and out of
 * which investigation.
 *
 * Entirely separate from anything that happened to what the account wrote. A
 * suspended account keeps its published reviews; a removed review says nothing
 * about its author's standing. All four combinations are reachable and
 * ordinary.
 */
export interface Sanction {
  id: string;
  userId: string;
  action: SanctionAction;
  reasonKey: string;
  reason: string;
  caseId: string | null;
  caseReference: string | null;
  appliedBy: string | null;
  startsAt: string;
  /** Null is indefinite — always for a ban, sometimes for a suspension. */
  endsAt: string | null;
  liftedAt: string | null;
  liftedBy: string | null;
  liftedReason: string | null;
  /** Not lifted, and not expired. */
  isActive: boolean;
  createdAt: string;
}
