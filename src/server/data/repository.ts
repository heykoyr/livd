import type {
  ClaimStatus,
  ModerationAction,
  Property,
  PropertyClaim,
  PropertyIntelligence,
  PropertySummary,
  PublicReview,
  ReportStatus,
  ResidencyStatus,
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

/**
 * The data contract.
 *
 * Every read and write in the application goes through this interface. Two
 * adapters implement it — a file-backed local store and PostgreSQL via Supabase
 * — and `tests/data/repository.contract.test.ts` holds both to the same
 * behaviour.
 *
 * The interface is shaped by what production needs, never narrowed to what the
 * local store finds convenient. That constraint is the reason the two stay
 * genuinely interchangeable rather than drifting into a real implementation and
 * a toy one.
 */

/* -------------------------------------------------------------------------
 * Inputs
 * ---------------------------------------------------------------------- */

export interface CreatePropertyInput {
  buildingName: string | null;
  streetAddress: string | null;
  neighbourhood: string | null;
  locality: string;
  adminArea: string | null;
  postalCode: string | null;
  countryCode: string;
  propertyType: Property['propertyType'];
}

export interface CreateReviewInput {
  propertyId: string;
  residencyStatus: ResidencyStatus;
  movedInMonth: string;
  movedOutMonth: string | null;
  overallRating: number;
  categoryRatings: Array<{ categoryKey: string; rating: number }>;
  positiveTags: string[];
  problemTags: string[];
  primaryDepartureReason: string | null;
  secondaryDepartureReasons: string[];
  noticedManagementChange: boolean | null;
  body: string | null;
  wouldRecommend: boolean;
  rentAmountMinor: number | null;
  rentCurrency: string | null;
  rentPeriod: 'month' | 'year' | null;
  /** Set by the submit action from the content linter. */
  status: ReviewStatus;
  safetyFlags: string[];
}

export interface ReviewListOptions {
  residency?: ResidencyStatus | 'all';
  verifiedOnly?: boolean;
  sort?: 'recent' | 'helpful' | 'highest' | 'lowest';
  page?: number;
  pageSize?: number;
}

export interface ReviewListResult {
  items: PublicReview[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DiscoveryOptions {
  limit?: number;
  countryCode?: string | null;
}

export interface LocalitySummary {
  countryCode: string;
  locality: string;
  adminArea: string | null;
  propertyCount: number;
  reviewCount: number;
  href: string;
}

export interface AdminOverview {
  propertyCount: number;
  reviewCount: number;
  pendingModerationCount: number;
  openReportCount: number;
  pendingClaimCount: number;
  userCount: number;
  reviewsLast30Days: number;
}

/* -------------------------------------------------------------------------
 * Repository
 * ---------------------------------------------------------------------- */

export interface LivdRepository {
  /* ---- Properties ---- */

  getPropertyBySlug(slug: string): Promise<Property | null>;
  getPropertyById(id: string): Promise<Property | null>;
  getPropertySummary(propertyId: string): Promise<PropertySummary | null>;
  getPropertyIntelligence(propertyId: string): Promise<PropertyIntelligence>;
  createProperty(input: CreatePropertyInput, createdBy: string): Promise<Property>;

  /**
   * Finds an existing active property matching the same real-world address, so
   * a contributor adding a property they could not find does not create a
   * duplicate of one that already exists under a different spelling.
   */
  findDuplicateProperty(input: CreatePropertyInput): Promise<Property | null>;

  /* ---- Search & discovery ---- */

  searchProperties(filters: SearchFilters): Promise<SearchResults>;
  suggest(query: string, limit: number): Promise<SearchSuggestion[]>;
  recentlyReviewed(options?: DiscoveryOptions): Promise<PropertySummary[]>;
  mostReviewed(options?: DiscoveryOptions): Promise<PropertySummary[]>;
  highestRated(options?: DiscoveryOptions): Promise<PropertySummary[]>;
  listLocalities(countryCode?: string | null): Promise<LocalitySummary[]>;
  propertiesInLocality(countryCode: string, locality: string): Promise<PropertySummary[]>;

  /* ---- Reviews ---- */

  listPublicReviews(propertyId: string, options?: ReviewListOptions): Promise<ReviewListResult>;
  getReviewById(id: string): Promise<Review | null>;
  listReviewsByAuthor(authorId: string): Promise<Review[]>;
  createReview(input: CreateReviewInput, authorId: string): Promise<Review>;
  updateReview(
    id: string,
    authorId: string,
    patch: Partial<Pick<CreateReviewInput, 'body' | 'wouldRecommend'>>,
  ): Promise<Review>;
  /**
   * True when this author already has a review covering the same tenancy —
   * the duplicate-prevention rule. Enforced in the database by a unique index
   * as well; this is the check that produces a helpful message.
   */
  hasExistingReview(propertyId: string, authorId: string, movedInMonth: string): Promise<boolean>;
  markReviewHelpful(reviewId: string, userId: string): Promise<number>;

  /* ---- Moderation ---- */

  setReviewStatus(reviewId: string, status: ReviewStatus, actorId: string, reason: string): Promise<void>;
  setReviewVerification(reviewId: string, level: VerificationLevel, actorId: string): Promise<void>;
  listReviewsByStatus(status: ReviewStatus, limit?: number): Promise<Array<{ review: Review; property: Property }>>;

  createReport(input: {
    reviewId: string;
    reporterId: string;
    reason: ReviewReport['reason'];
    detail: string | null;
  }): Promise<ReviewReport>;
  listReports(status?: ReportStatus): Promise<Array<{ report: ReviewReport; review: Review; property: Property }>>;
  resolveReport(
    reportId: string,
    status: Extract<ReportStatus, 'upheld' | 'dismissed'>,
    actorId: string,
    resolution: string,
  ): Promise<void>;

  recordModerationAction(input: Omit<ModerationAction, 'id' | 'createdAt'>): Promise<ModerationAction>;
  listModerationActions(subjectId?: string, limit?: number): Promise<ModerationAction[]>;

  /* ---- Claims & owner responses ---- */

  createClaim(input: {
    propertyId: string;
    claimantId: string;
    roleClaimed: PropertyClaim['roleClaimed'];
    organisation: string | null;
    contactEmail: string;
  }): Promise<PropertyClaim>;
  listClaims(status?: ClaimStatus): Promise<Array<{ claim: PropertyClaim; property: Property }>>;
  decideClaim(
    claimId: string,
    status: Extract<ClaimStatus, 'approved' | 'rejected'>,
    actorId: string,
  ): Promise<void>;
  getApprovedClaim(propertyId: string): Promise<PropertyClaim | null>;
  /**
   * Whether an approved claim exists — the single publicly visible fact about
   * a claim.
   *
   * Separate from `getApprovedClaim` because that returns the claimant's
   * identity and is readable only by the claimant and by moderators. A visitor
   * is entitled to know a property is claimed; nobody is entitled to know who
   * claimed it.
   */
  isPropertyClaimed(propertyId: string): Promise<boolean>;
  /** The properties this user may respond on behalf of. */
  listClaimedPropertyIds(userId: string): Promise<string[]>;

  createOwnerResponse(input: {
    reviewId: string;
    responderId: string;
    body: string;
    isResolutionNotice: boolean;
  }): Promise<void>;

  /* ---- Saved properties ---- */

  listSavedProperties(userId: string): Promise<Array<SavedProperty & { summary: PropertySummary }>>;
  saveProperty(userId: string, propertyId: string): Promise<void>;
  unsaveProperty(userId: string, propertyId: string): Promise<void>;
  isPropertySaved(userId: string, propertyId: string): Promise<boolean>;
  setSavedPropertyNote(userId: string, propertyId: string, note: string | null): Promise<void>;

  /* ---- Users ---- */

  getUserById(id: string): Promise<UserProfile | null>;
  getUserByEmail(email: string): Promise<UserProfile | null>;
  upsertUser(input: { id?: string; email: string; countryCode?: string | null }): Promise<UserProfile>;
  listUsers(limit?: number): Promise<UserProfile[]>;
  setUserRole(userId: string, role: UserProfile['role'], actorId: string): Promise<void>;

  /* ---- Analytics ---- */

  /** Counted events only. No user id, no raw query text — see the schema notes. */
  recordSearch(input: {
    queryHash: string;
    countryCode: string | null;
    locality: string | null;
    resultCount: number;
  }): Promise<void>;

  adminOverview(): Promise<AdminOverview>;
}
