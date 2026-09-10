import type {
  AdminUserDetail,
  AdminUserFilters,
  AdminUserPage,
  AdminUserReport,
  AdminUserReview,
  AuthorityRequest,
  AuthorityRequestStatus,
  AuthorityRequestType,
  CaseCategory,
  CaseEvent,
  CaseFilters,
  CaseNote,
  CasePage,
  CasePriority,
  CaseStatus,
  CaseEvidenceItem,
  CaseSummary,
  ClaimStatus,
  DisclosureRecord,
  UserRole,
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
  ReviewInvestigation,
  ReviewReportEntry,
  ReviewSnapshot,
  ReviewStatus,
  ReviewVerificationEntry,
  Sanction,
  SanctionAction,
  SanctionReason,
  SavedProperty,
  SearchFilters,
  SearchResults,
  SearchSuggestion,
  UserProfile,
  UserStatus,
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
import type { AdminAuditEntry } from '@/server/admin/audit';

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

/**
 * The result of crossing the identity boundary.
 *
 * Carries the address and the account's own metadata, and deliberately nothing
 * else — not their reviews, not their verification evidence, not their location
 * history. The reveal answers "who is this account" and stops, because every
 * extra field would be one more thing disclosed on the strength of a reason
 * that only justified the first.
 *
 * `auditEntryId` is returned so the caller can show the person that the access
 * was recorded, and point at the record.
 */
export interface IdentityReveal {
  email: string;
  accountId: string;
  role: UserRole;
  status: UserStatus;
  countryCode: string | null;
  createdAt: string;
  auditEntryId: string;
}

export interface IdentityAccessReason {
  key: string;
  label: string;
  description: string;
  /** Whether a dropdown selection alone is a meaningful answer. */
  requiresDetail: boolean;
}

/** One recorded look at an account's identity. */
export interface IdentityAccessRecord {
  id: string;
  actorId: string | null;
  actorRole: UserRole;
  outcome: 'succeeded' | 'denied' | 'failed';
  reason: string | null;
  caseReference: string | null;
  createdAt: string;
}

/** One entry in the administrative audit log, as a reader sees it. */
export interface AdminAuditRecord {
  id: string;
  /** Null once the administrator has deleted their account. The entry survives. */
  actorId: string | null;
  /** What they were at the time, never re-read from the profile. */
  actorRole: UserRole;
  action: string;
  subjectType: string;
  subjectId: string | null;
  outcome: 'succeeded' | 'denied' | 'failed';
  reason: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface AdminAuditPage {
  items: AdminAuditRecord[];
  total: number;
  page: number;
  pageSize: number;
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

  /* ---- Authority requests ---- */

  /**
   * Records a request from a body asserting a legal basis.
   *
   * Records it. Nothing in this interface gathers or transmits the information
   * a request asks for, and there is deliberately no method that could — a
   * button that assembles and sends an account's data is a button that will
   * eventually be pressed for a request nobody read properly.
   */
  openAuthorityRequest(input: {
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
  }): Promise<string>;

  decideAuthorityRequest(input: {
    requestId: string;
    status: AuthorityRequestStatus;
    decision: string | null;
    documentationReceived: boolean | null;
    actorId: string;
  }): Promise<void>;

  /**
   * Records that a person disclosed something.
   *
   * Discloses nothing itself. Refuses unless the request has been approved in
   * whole or in part — a disclosure against a declined or undecided request is
   * either a mistake or something far worse, and the database should not
   * quietly accept either.
   */
  recordDisclosure(input: {
    requestId: string;
    disclosedFields: string[];
    disclosedTo: string;
    method: DisclosureRecord['method'];
    notes: string | null;
    actorId: string;
  }): Promise<string>;

  listAuthorityRequests(options?: {
    status?: AuthorityRequestStatus | null;
    openOnly?: boolean;
    limit?: number;
  }): Promise<AuthorityRequest[]>;

  listDisclosures(requestId?: string | null): Promise<DisclosureRecord[]>;

  /* ---- Sanctions ---- */

  /**
   * Sanctions an account.
   *
   * The sanction row, the profile standing and the audit entry are one
   * transaction, so an account whose standing changed without a recorded reason
   * is not a state the database can reach.
   *
   * Nothing here touches a review. Removing content is a separate decision with
   * its own reason and its own record — a system that conflates the two
   * punishes people twice for one thing, or not at all for another.
   */
  applySanction(input: {
    userId: string;
    action: SanctionAction;
    reasonKey: string;
    reason: string;
    durationDays: number | null;
    caseId: string | null;
    actorId: string;
  }): Promise<string>;

  /** Lifts a sanction early. Requires the tier that could have applied it. */
  liftSanction(sanctionId: string, reason: string, actorId: string): Promise<void>;

  listSanctions(options?: {
    userId?: string | null;
    activeOnly?: boolean;
    limit?: number;
  }): Promise<Sanction[]>;

  listSanctionReasons(): Promise<SanctionReason[]>;

  /* ---- Evidence ---- */

  /**
   * What a review said before each change.
   *
   * Written by a trigger in Postgres, so a moderation path cannot skip it. The
   * audit found the previous state of affairs: `setReviewStatus` changed a
   * status and recorded that it had, but kept no copy of what the review said —
   * and the update guard exempts moderators, so a moderator could rewrite any
   * review body with nothing recording what it had been.
   */
  listReviewSnapshots(reviewId: string): Promise<ReviewSnapshot[]>;

  /** Evidence attached to a case. Rows, never storage keys. */
  listCaseEvidence(caseId: string): Promise<CaseEvidenceItem[]>;

  addCaseEvidence(input: {
    caseId: string;
    kind: CaseEvidenceItem['kind'];
    title: string;
    description: string | null;
    supersedes: string | null;
    actorId: string;
  }): Promise<string>;

  /** Marks evidence withdrawn. Never removes it. */
  withdrawCaseEvidence(evidenceId: string, reason: string, actorId: string): Promise<void>;

  /* ---- Review investigation ---- */

  /**
   * Everything an investigation needs about one review, in one read.
   *
   * A single call rather than a join the caller assembles, so a page cannot
   * accidentally omit the context that changes a decision. The author's other
   * reviews are the obvious one: four reviews of four properties across three
   * years reads very differently from four in a week, and a moderator who never
   * sees the second number decides the first case wrong.
   */
  getReviewInvestigation(reviewId: string): Promise<ReviewInvestigation | null>;

  /** What was checked about this review's author. Verdicts, never positions. */
  listReviewVerification(reviewId: string): Promise<ReviewVerificationEntry[]>;

  /** Reports about this review, with the case each belongs to. */
  listReviewReports(reviewId: string): Promise<ReviewReportEntry[]>;

  /* ---- Trust & Safety cases ---- */

  /**
   * Opens a case, optionally from a report.
   *
   * Opening a case does **nothing** to the review it concerns — it is not
   * hidden, not flagged, not touched. If opening a case had a visible effect,
   * opening cases would become the attack, in the same way that hiding on
   * report would make reporting one.
   *
   * Idempotent on the report: one already attached to a case returns that case
   * rather than opening a second. Two moderators clicking at once is a normal
   * Tuesday, not an error.
   */
  openCase(input: {
    category: string;
    summary: string;
    fromReportId?: string | null;
    reviewId?: string | null;
    priority?: CasePriority | null;
    actorId: string;
  }): Promise<string>;

  listCases(filters?: CaseFilters): Promise<CasePage>;
  getCase(caseId: string): Promise<CaseSummary | null>;
  listCaseEvents(caseId: string, limit?: number): Promise<CaseEvent[]>;
  listCaseNotes(caseId: string, limit?: number): Promise<CaseNote[]>;
  listCaseReports(caseId: string): Promise<ReviewReport[]>;
  listCaseCategories(): Promise<CaseCategory[]>;

  assignCase(caseId: string, assigneeId: string | null, actorId: string): Promise<void>;
  setCaseStatus(
    caseId: string,
    status: CaseStatus,
    outcome: string | null,
    actorId: string,
  ): Promise<void>;
  setCasePriority(
    caseId: string,
    priority: CasePriority,
    why: string | null,
    actorId: string,
  ): Promise<void>;
  addCaseNote(caseId: string, body: string, actorId: string): Promise<void>;
  setCasePreservation(
    caseId: string,
    hold: boolean,
    why: string,
    actorId: string,
  ): Promise<void>;

  /* ---- Administrative audit ---- */

  /**
   * Records one sensitive administrative access.
   *
   * Separate from `recordModerationAction`, which records decisions about
   * content. This records *reads* as well — that somebody opened a tenancy
   * agreement, or looked up who wrote a review — which the moderation trail
   * cannot express, because a read is not a decision and there was never a row
   * to attach it to.
   *
   * Called by `runAdminAction`, not by operations themselves. The actor is
   * stamped from the session inside the database, so an entry cannot be
   * attributed to somebody who did not do the thing.
   */
  recordAdminAudit(entry: AdminAuditEntry): Promise<void>;

  /* ---- Identity ---- */

  /**
   * Reveals an account's email address.
   *
   * The one operation that crosses the boundary the product is built around,
   * and the reason it is a repository method rather than a read is that it must
   * be atomic with its own record. `livd_reveal_user_identity` writes the audit
   * entry and returns the address in the same transaction, so there is no
   * ordering in which a disclosure happens and nothing is written down.
   *
   * Server code could read the address and then log it, and would be correct
   * almost always. "Almost always" is the wrong standard for the operation
   * whose entire purpose is accountability.
   */
  revealUserIdentity(input: {
    userId: string;
    reasonKey: string;
    reasonDetail: string | null;
    caseReference: string | null;
    actorIpHash: string | null;
    /** Used only by the local adapter; Postgres reads it from the session. */
    actorId: string;
  }): Promise<IdentityReveal>;

  /** The reasons an identity may be accessed for. A configurable vocabulary. */
  listIdentityAccessReasons(): Promise<IdentityAccessReason[]>;

  /**
   * Who has looked at this account's identity, and why.
   *
   * Readable by a moderator even though performing the access is not: seeing
   * that an identity was accessed is the deterrent, and an access log nobody
   * ever reads deters nothing.
   */
  listIdentityAccess(userId: string, limit?: number): Promise<IdentityAccessRecord[]>;

  /** The audit log, newest first. Trust & Safety and above only. */
  listAdminAudit(options?: {
    page?: number;
    pageSize?: number;
    action?: string | null;
    subjectId?: string | null;
  }): Promise<AdminAuditPage>;

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

  /**
   * Resolves an address the caller already holds to an account id.
   *
   * Deliberately returns an id and not a profile. The previous method returned
   * a `UserProfile` carrying the email, which made "look up who this is" a
   * capability any caller inherited by accident; this one gives back only an
   * internal identifier, and only to somebody who already knew the address.
   *
   * It also replaces an implementation that pulled the whole Auth user list
   * and searched the first page — silently answering "no such account" for
   * anyone past the fiftieth, which was already wrong at this deployment's
   * size. Against Postgres it is now one indexed lookup behind a moderator
   * check.
   */
  findUserIdByEmail(email: string): Promise<string | null>;

  upsertUser(input: { id?: string; email: string; countryCode?: string | null }): Promise<UserProfile>;

  /**
   * One page of the administrative user directory.
   *
   * Returns `AdminUserSummary`, which has no email field at all — the mask is
   * applied in the database, so the address is never selected into this
   * process. `/admin/users` previously rendered every account's real address to
   * anyone the layout guard admitted, which includes moderators, and recorded
   * nothing.
   */
  listAdminUsers(filters?: AdminUserFilters): Promise<AdminUserPage>;

  /**
   * One account, as a moderator is entitled to see it.
   *
   * Masked, like the directory. Nothing here identifies the person — it is
   * their standing and the shape of their activity, which is what an
   * investigation actually runs on. Revealing the address is a separate
   * operation with its own authorisation and its own audit entry.
   */
  getAdminUserDetail(userId: string): Promise<AdminUserDetail | null>;

  /** What one account has written, and what happened to each of them. */
  listAdminUserReviews(
    userId: string,
    options?: { page?: number; pageSize?: number },
  ): Promise<{ items: AdminUserReview[]; total: number; page: number; pageSize: number }>;

  /** Reports about what one account wrote. The reporter stays an id. */
  listAdminUserReports(
    userId: string,
    options?: { page?: number; pageSize?: number },
  ): Promise<{ items: AdminUserReport[]; total: number; page: number; pageSize: number }>;

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
