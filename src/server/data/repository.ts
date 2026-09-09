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
  PropertyFlag,
  PropertyFlagStatus,
  PropertyVerification,
  VerificationStanding,
  VerificationCheck,
  VerificationLevel,
  VerificationMethod,
  VerificationOutcome,
  VerificationRecord,
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
  /**
   * Resolved by the geocoder, when one is configured and it succeeded.
   *
   * Optional and frequently absent, which is the normal case rather than an
   * error: a property with no coordinate simply cannot be location-verified,
   * and the review wizard does not offer the step for it. The database rounds
   * whatever is stored here to three decimal places, so this never becomes a
   * unit-precise position however precise the geocoder was.
   */
  coordinates?: { latitude: number; longitude: number } | null;
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
  /**
   * The location verification this review is claiming, if any.
   *
   * An id, never a level. The store derives the level from the record — after
   * checking it belongs to this author and this property — so that a caller
   * who has not verified anything cannot assert that they have. Against
   * Postgres that check is a BEFORE INSERT trigger; the local adapter performs
   * the identical one in TypeScript.
   */
  verificationId: string | null;
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

export interface NearbyProperty {
  summary: PropertySummary;
  /**
   * Distance from the visitor, in metres. Computed per request from a position
   * that is never stored, and rounded before it leaves the data layer — a
   * metre-precise distance to a known building is a position.
   */
  distanceMeters: number;
}

export interface LocalitySummary {
  countryCode: string;
  locality: string;
  adminArea: string | null;
  propertyCount: number;
  reviewCount: number;
  href: string;
}

/** What an account erasure actually did. Reported back, never guessed at. */
export interface AccountDeletionSummary {
  /** Reviews left standing on property pages, now unattributable. */
  reviewsUnlinked: number;
  /** Owner responses left standing, now unattributable. */
  responsesUnlinked: number;
  /** Residency documents destroyed, file and row together. */
  evidenceFilesDestroyed: number;
  /** Location-check records destroyed. */
  locationChecksDestroyed: number;
  /** Saved properties destroyed. */
  savedPropertiesDestroyed: number;
}

export interface AdminOverview {
  propertyCount: number;
  reviewCount: number;
  pendingModerationCount: number;
  openReportCount: number;
  openFlagCount: number;
  pendingVerificationCount: number;
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

  /* --- Property verification (location) --- */

  /**
   * What this person may claim about this property right now.
   *
   * Answers two questions the review wizard needs before it renders: can this
   * property be verified at all (it cannot without coordinates), and does the
   * caller already hold a live verification for it — so somebody who verified,
   * wandered off and came back is not asked to do it twice.
   */
  getVerificationStanding(userId: string, propertyId: string): Promise<VerificationStanding>;

  /**
   * Decides whether a position is at a property, and records the outcome.
   *
   * The position is an argument. Nothing in the returned record carries a
   * coordinate, an accuracy or a distance, and nothing is written that does —
   * see the note on `PropertyVerification`.
   *
   * Against Postgres the arithmetic runs inside `livd_verify_property_location`
   * rather than here, so a browser holding the public key cannot assert a
   * verdict by calling the table directly. The local adapter runs the same rule
   * from `src/lib/geo/proximity.ts`.
   */
  verifyPropertyLocation(input: {
    userId: string;
    propertyId: string;
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    capturedAtMs: number;
  }): Promise<PropertyVerification>;

  /** A person's own verification history. Theirs to see; nobody else's. */
  listPropertyVerifications(userId: string, limit?: number): Promise<PropertyVerification[]>;

  /**
   * Recent attempts across all accounts, for a moderator investigating abuse.
   *
   * Carries a user id, because "which account is doing this" is the question
   * being asked. It carries no location, because that is not.
   */
  listRecentVerificationAttempts(
    limit?: number,
  ): Promise<Array<{ verification: PropertyVerification; property: Property }>>;

  /**
   * Properties within a radius of a point.
   *
   * For the opt-in "near you" surface. The position is used for one query and
   * discarded; no row anywhere records that this visitor was here.
   */
  propertiesNear(input: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
    limit?: number;
  }): Promise<NearbyProperty[]>;

  /* --- Residency verification --- */

  /**
   * Everything the automated checks need to judge a submission, gathered in one
   * round trip. Returns null if the review does not exist or is not this
   * person's to verify.
   *
   * The checks themselves live in `src/lib/safety/verification-checks.ts` and
   * are run by the Server Action, not here — the data layer answers questions,
   * it does not hold opinions.
   */
  gatherVerificationContext(input: {
    reviewId: string;
    submitterId: string;
    evidenceSha256: string;
  }): Promise<{
    review: Review;
    property: Property;
    submitterCreatedAt: string;
    submitterOwnsProperty: boolean;
    /** Accounts that previously submitted a file with this same hash. */
    priorSubmitterIds: string[];
    recentSubmissionCount: number;
  } | null>;

  /** Stores the evidence privately and opens a pending record. */
  recordVerificationSubmission(input: {
    reviewId: string;
    submitterId: string;
    method: VerificationMethod;
    checks: VerificationCheck[];
    file: { data: Uint8Array; type: string; bytes: number; sha256: string };
  }): Promise<VerificationRecord>;

  listPendingVerifications(): Promise<
    Array<{ record: VerificationRecord; review: Review; property: Property }>
  >;

  /** What a resident is allowed to know about their own requests. */
  listVerificationsForReview(reviewId: string): Promise<VerificationRecord[]>;

  /**
   * Records the decision and, on approval, sets the review's verification
   * level. Rejection leaves the level alone rather than marking the review
   * disputed: failing to prove residency is not the same as being caught
   * lying about it.
   */
  decideVerification(
    recordId: string,
    outcome: Extract<VerificationOutcome, 'approved' | 'rejected'>,
    actorId: string,
    notes: string,
  ): Promise<void>;

  /**
   * A short-lived link to the evidence, for a moderator who is deciding.
   *
   * Minted per view and never stored. The object key never leaves the adapter,
   * so no route or component can address the file directly.
   */
  createVerificationEvidenceLink(recordId: string): Promise<string | null>;

  /* --- Automated signals --- */

  /**
   * Flags raised by burst detection, most urgent first.
   *
   * Against Supabase these are rows written by a pg_cron job. The local
   * adapter has no scheduler, so it derives the same signals from the store on
   * read — the rules live in `src/lib/safety/burst-detection.ts` either way,
   * and the SQL in migration 0011 mirrors them.
   */
  listPropertyFlags(
    status?: PropertyFlagStatus,
  ): Promise<Array<{ flag: PropertyFlag; property: Property }>>;

  /** Records a moderator's decision. A flag is never removed, only decided. */
  decidePropertyFlag(
    flagId: string,
    status: Extract<PropertyFlagStatus, 'reviewed' | 'dismissed'>,
    actorId: string,
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

  /**
   * Grants a role.
   *
   * `actorId` is the caller as the application understands them, and the
   * Supabase adapter does **not** trust it: the database derives the actor
   * from `auth.uid()` inside `livd_set_user_role` and enforces the whole rule
   * set there — administrator only, never yourself, never the last
   * administrator, always with a reason, always audited, all in one
   * transaction. The argument is carried for the local adapter, which has no
   * database session and applies the identical rules in TypeScript.
   *
   * That asymmetry is deliberate. Authorisation for this operation is not
   * something server code asserts; it is something the database decides, so a
   * Server Action holding the service-role key cannot grant a role either.
   */
  setUserRole(
    userId: string,
    role: UserProfile['role'],
    actorId: string,
    reason: string,
  ): Promise<void>;

  /**
   * Changes an account's standing. Same contract as `setUserRole`.
   *
   * Restricting is ordinary moderation; suspending requires Trust & Safety
   * authorisation, and acting on another privileged account requires an
   * administrator. Enforced in the database, not here.
   */
  setUserStatus(
    userId: string,
    status: UserProfile['status'],
    actorId: string,
    reason: string,
  ): Promise<void>;

  /**
   * Erases an account.
   *
   * What survives is what the legal pages promise survives: published reviews
   * and owner responses stay on the property record, permanently severed from
   * the person who wrote them. Everything private goes — the shortlist, the
   * notifications, the helpful votes, the location checks, and every residency
   * document with its file.
   *
   * That last one is the reason this is a repository method rather than a
   * single delete: the database cascade removes the verification *row* but
   * cannot touch the *file* in the private bucket. A tenancy agreement carries
   * a name, an address and a signature, and orphaning one in storage would be
   * the worst possible outcome of a feature whose entire purpose is erasure.
   * The evidence is destroyed first; only then is the account removed.
   *
   * Returns a summary of what happened, so the caller can tell the person
   * plainly rather than claiming more than was done.
   */
  deleteAccount(userId: string): Promise<AccountDeletionSummary>;

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
