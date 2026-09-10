import type {
  ModerationAction,
  Property,
  PropertyClaim,
  PropertyFlag,
  PropertyTypeKey,
  PropertyVerification,
  Review,
  ReviewReport,
  UserProfile,
  VerificationRecord,
} from '@/types/domain';

/**
 * Row → domain mappers.
 *
 * Kept separate from the adapter so the shape of the database and the shape of
 * the product can be compared side by side, and so a column added to a table
 * cannot reach the domain object — and from there a component — without someone
 * deciding it should.
 */

export interface PropertyRow {
  id: string;
  slug: string;
  building_name: string | null;
  street_address: string | null;
  neighbourhood: string | null;
  locality: string;
  admin_area: string | null;
  postal_code: string | null;
  country_code: string;
  latitude: number | null;
  longitude: number | null;
  property_type: string;
  unit_count: number | null;
  year_built: number | null;
  status: Property['status'];
  merged_into: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export function toProperty(row: PropertyRow): Property {
  return {
    id: row.id,
    slug: row.slug,
    address: {
      buildingName: row.building_name,
      streetAddress: row.street_address,
      neighbourhood: row.neighbourhood,
      locality: row.locality,
      adminArea: row.admin_area,
      postalCode: row.postal_code,
      countryCode: row.country_code,
    },
    propertyType: row.property_type as PropertyTypeKey,
    coordinates:
      row.latitude !== null && row.longitude !== null
        ? { latitude: row.latitude, longitude: row.longitude }
        : null,
    unitCount: row.unit_count,
    yearBuilt: row.year_built,
    status: row.status,
    mergedInto: row.merged_into,
    isDemo: row.is_demo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ReviewRow {
  id: string;
  property_id: string;
  author_id: string;
  residency_status: Review['residencyStatus'];
  moved_in_month: string;
  moved_out_month: string | null;
  tenure_months: number;
  overall_rating: number;
  body: string | null;
  would_recommend: boolean;
  rent_amount_minor: number | null;
  rent_currency: string | null;
  rent_period: Review['rentPeriod'];
  noticed_management_change: boolean | null;
  verification_level: Review['verificationLevel'];
  verification_id: string | null;
  verified_at: string | null;
  status: Review['status'];
  safety_flags: string[] | null;
  helpful_count: number;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
  review_category_ratings?: Array<{ category_key: string; rating: number }> | null;
  review_departure_reasons?: Array<{ reason_key: string; is_primary: boolean }> | null;
  review_tags?: Array<{ tag_key: string }> | null;
}

/**
 * @param tagPolarity Maps a tag key to its polarity. Passed in because the
 *   join does not carry it, and splitting positives from problems in the
 *   database would duplicate the reference data.
 */
export function toReview(row: ReviewRow, tagPolarity: Map<string, 'positive' | 'problem'>): Review {
  const departures = row.review_departure_reasons ?? [];
  const tags = (row.review_tags ?? []).map((t) => t.tag_key);

  return {
    id: row.id,
    propertyId: row.property_id,
    authorId: row.author_id,
    residencyStatus: row.residency_status,
    movedInMonth: row.moved_in_month,
    movedOutMonth: row.moved_out_month,
    tenureMonths: row.tenure_months,
    overallRating: row.overall_rating,
    body: row.body,
    wouldRecommend: row.would_recommend,
    rent:
      row.rent_amount_minor !== null && row.rent_currency
        ? { amountMinor: row.rent_amount_minor, currencyCode: row.rent_currency }
        : null,
    rentPeriod: row.rent_period,
    categoryRatings: (row.review_category_ratings ?? []).map((r) => ({
      categoryKey: r.category_key,
      rating: r.rating,
    })),
    positiveTags: tags.filter((key) => tagPolarity.get(key) === 'positive'),
    problemTags: tags.filter((key) => tagPolarity.get(key) === 'problem'),
    primaryDepartureReason: departures.find((d) => d.is_primary)?.reason_key ?? null,
    secondaryDepartureReasons: departures.filter((d) => !d.is_primary).map((d) => d.reason_key),
    noticedManagementChange: row.noticed_management_change,
    verificationLevel: row.verification_level,
    verificationId: row.verification_id,
    verifiedAt: row.verified_at,
    status: row.status,
    safetyFlags: row.safety_flags ?? [],
    helpfulCount: row.helpful_count,
    isDemo: row.is_demo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ProfileRow {
  id: string;
  role: UserProfile['role'];
  status: UserProfile['status'];
  country_code: string | null;
  preferred_locale: string;
  created_at: string;
}

export function toUserProfile(row: ProfileRow, email: string): UserProfile {
  return {
    id: row.id,
    email,
    role: row.role,
    status: row.status,
    countryCode: row.country_code,
    preferredLocale: row.preferred_locale,
    createdAt: row.created_at,
  };
}

export interface ReportRow {
  id: string;
  review_id: string;
  reporter_id: string;
  reason: ReviewReport['reason'];
  detail: string | null;
  status: ReviewReport['status'];
  resolution: string | null;
  case_id?: string | null;
  created_at: string;
  resolved_at: string | null;
}

export function toReport(row: ReportRow): ReviewReport {
  return {
    id: row.id,
    reviewId: row.review_id,
    reporterId: row.reporter_id,
    reason: row.reason,
    detail: row.detail,
    status: row.status,
    resolution: row.resolution,
    caseId: row.case_id ?? null,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

export interface PropertyFlagRow {
  id: string;
  property_id: string;
  kind: PropertyFlag['kind'];
  severity: number;
  window_start: string;
  window_end: string;
  observed: Record<string, number | string | null>;
  detail: string;
  status: PropertyFlag['status'];
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export function toPropertyFlag(row: PropertyFlagRow): PropertyFlag {
  return {
    id: row.id,
    propertyId: row.property_id,
    kind: row.kind,
    // The column is a smallint with a 1-3 check constraint; the cast carries
    // that guarantee across into the type rather than widening it to number.
    severity: row.severity as PropertyFlag['severity'],
    windowStart: row.window_start,
    windowEnd: row.window_end,
    observed: row.observed ?? {},
    detail: row.detail,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

export interface VerificationRecordRow {
  id: string;
  subject_type: VerificationRecord['subjectType'];
  subject_id: string;
  submitted_by: string | null;
  method: VerificationRecord['method'];
  outcome: VerificationRecord['outcome'];
  checks: VerificationRecord['checks'] | null;
  evidence_mime: string | null;
  evidence_bytes: number | null;
  notes: string | null;
  reviewed_by: string | null;
  decided_at: string | null;
  created_at: string;
}

/**
 * Note what is not mapped: `evidence_ref`.
 *
 * The object key stays inside the adapter, so no route, component or log can
 * render it by accident. Evidence reaches a moderator only through a signed
 * URL minted per view.
 */
export function toVerificationRecord(row: VerificationRecordRow): VerificationRecord {
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    submittedBy: row.submitted_by,
    method: row.method,
    outcome: row.outcome,
    checks: row.checks ?? [],
    evidenceMime: row.evidence_mime,
    evidenceBytes: row.evidence_bytes,
    notes: row.notes,
    reviewedBy: row.reviewed_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

export interface ClaimRow {
  id: string;
  property_id: string;
  claimant_id: string;
  role_claimed: PropertyClaim['roleClaimed'];
  organisation: string | null;
  contact_email: string;
  status: PropertyClaim['status'];
  reviewed_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export function toClaim(row: ClaimRow): PropertyClaim {
  return {
    id: row.id,
    propertyId: row.property_id,
    claimantId: row.claimant_id,
    roleClaimed: row.role_claimed,
    organisation: row.organisation,
    contactEmail: row.contact_email,
    status: row.status,
    reviewedBy: row.reviewed_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

export interface ModerationActionRow {
  id: string;
  actor_id: string;
  /** Null for rows written before 0035. Never back-filled. */
  actor_role: ModerationAction['actorRole'];
  subject_type: ModerationAction['subjectType'];
  subject_id: string;
  action: string;
  reason: string | null;
  previous_status: string | null;
  new_status: string | null;
  created_at: string;
}

export function toModerationAction(row: ModerationActionRow): ModerationAction {
  return {
    id: row.id,
    actorId: row.actor_id,
    actorRole: row.actor_role ?? null,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    action: row.action,
    reason: row.reason,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    createdAt: row.created_at,
  };
}

/* -------------------------------------------------------------------------
 * Property verification
 * ---------------------------------------------------------------------- */

export interface PropertyVerificationRow {
  id: string;
  user_id: string;
  property_id: string;
  method: PropertyVerification['method'];
  status: PropertyVerification['status'];
  failure_reason: PropertyVerification['failureReason'];
  expires_at: string;
  created_at: string;
}

/**
 * Note how short this is, and that no field was left out.
 *
 * The table holds no coordinate, no accuracy and no distance, so there is
 * nothing here for a mapper to have to remember to strip.
 */
export function toPropertyVerification(row: PropertyVerificationRow): PropertyVerification {
  return {
    id: row.id,
    userId: row.user_id,
    propertyId: row.property_id,
    method: row.method,
    status: row.status,
    failureReason: row.failure_reason,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export const PROPERTY_VERIFICATION_SELECT =
  'id, user_id, property_id, method, status, failure_reason, expires_at, created_at';

/** The nested select used everywhere a full review is needed. */
export const REVIEW_SELECT = `
  id, property_id, author_id, residency_status, moved_in_month, moved_out_month,
  tenure_months, overall_rating, body, would_recommend, rent_amount_minor,
  rent_currency, rent_period, noticed_management_change, verification_level,
  verification_id, verified_at,
  status, safety_flags, helpful_count, is_demo, created_at, updated_at,
  review_category_ratings ( category_key, rating ),
  review_departure_reasons ( reason_key, is_primary ),
  review_tags ( tag_key )
`;

export const PROPERTY_SELECT = `
  id, slug, building_name, street_address, neighbourhood, locality, admin_area,
  postal_code, country_code, latitude, longitude, property_type, unit_count,
  year_built, status, merged_into, is_demo, created_at, updated_at
`;
