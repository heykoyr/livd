import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { TAG_DEFINITIONS } from '@/config/tags';
import { LIMITS, showDemoData } from '@/config/site';
import { buildPropertyIntelligence, emptyIntelligence } from '@/lib/intelligence';
import { normaliseForSearch } from '@/lib/search/matching';
import { propertyContextLine, propertyDisplayName } from '@/lib/format';
import { propertySlug } from '@/lib/utils';
import {
  createAnonymousSupabaseClient,
  createServerSupabaseClient,
  createServiceRoleClient,
} from '@/server/auth/supabase-client';
import type {
  AdminUserDetail,
  AdminUserFilters,
  AdminUserPage,
  AdminUserReport,
  AdminUserReview,
  CaseCategory,
  CaseEvent,
  CaseFilters,
  CaseNote,
  CasePage,
  CasePriority,
  CaseStatus,
  AuthorityRequest,
  AuthorityRequestStatus,
  AuthorityRequestType,
  CaseEvidenceItem,
  CaseSummary,
  DisclosureRecord,
  CategoryRating,
  ClaimStatus,
  ReviewInvestigation,
  ReviewReportEntry,
  ReviewSnapshot,
  Sanction,
  SanctionAction,
  SanctionReason,
  ReviewVerificationEntry,
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
  VerificationStanding,
  VerificationCheck,
  VerificationLevel,
  VerificationMethod,
  VerificationOutcome,
  VerificationRecord,
} from '@/types/domain';
import type {
  AdminAuditPage,
  AdminOverview,
  AuditActionSummary,
  AuditActorSummary,
  AuditFeedFilters,
  AuditFeedPage,
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
import type { AdminAuditEntry } from '@/server/admin/audit';
import { toPublicReview } from '../public-review';
import {
  PROPERTY_SELECT,
  PROPERTY_VERIFICATION_SELECT,
  REVIEW_SELECT,
  toClaim,
  toModerationAction,
  toProperty,
  toPropertyFlag,
  toPropertyVerification,
  toVerificationRecord,
  toReport,
  toReview,
  toUserProfile,
  type ClaimRow,
  type ModerationActionRow,
  type ProfileRow,
  type PropertyFlagRow,
  type PropertyVerificationRow,
  type VerificationRecordRow,
  type PropertyRow,
  type ReportRow,
  type ReviewRow,
} from './mappers';

/**
 * PostgreSQL adapter.
 *
 * Reads go through the request-scoped client so every query is constrained by
 * Row Level Security. Moderation writes — and only those — use the service-role
 * client, always behind a guard that has already established the caller is a
 * moderator.
 *
 * Aggregates are computed in TypeScript from published reviews, so the property
 * page and the local adapter agree exactly. `property_stats` holds a
 * database-maintained copy used purely for ordering and filtering lists, where
 * loading every review would be wasteful.
 */

const TAG_POLARITY = new Map(TAG_DEFINITIONS.map((tag) => [tag.key, tag.polarity]));

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, context: string): T {
  if (result.error) {
    throw new Error(`${context}: ${result.error.message}`);
  }
  if (result.data === null) {
    throw new Error(`${context}: no data returned`);
  }
  return result.data;
}

/** The private bucket verification evidence lives in. Created in 0012. */
const EVIDENCE_BUCKET = 'verification-evidence';

/**
 * How long a moderator's link to a piece of evidence stays valid.
 *
 * Minutes rather than hours: a tenancy agreement carries a name, an address and
 * a signature, and the person who handed it over did so in order to stay
 * anonymous.
 */
const EVIDENCE_LINK_SECONDS = 300;

/** Default page size for administrative listings. */
const ADMIN_PAGE_SIZE = 25;

/** One row of `livd_admin_review_investigation`. */
interface ReviewInvestigationRow {
  review_id: string;
  body: string | null;
  overall_rating: number;
  would_recommend: boolean;
  residency_status: ReviewInvestigation['residencyStatus'];
  moved_in_month: string;
  moved_out_month: string | null;
  tenure_months: number;
  verification_level: ReviewInvestigation['verificationLevel'];
  verified_at: string | null;
  status: ReviewInvestigation['status'];
  safety_flags: string[] | null;
  helpful_count: number;
  created_at: string;
  updated_at: string;
  author_id: string | null;
  author_status: UserProfile['status'];
  author_created_at: string;
  author_review_count: number | string;
  author_removed_count: number | string;
  author_reports_against: number | string;
  author_verified_count: number | string;
  property_id: string;
  property_slug: string;
  building_name: string | null;
  street_address: string | null;
  neighbourhood: string | null;
  locality: string;
  admin_area: string | null;
  postal_code: string | null;
  country_code: string;
  property_review_count: number | string;
  property_reported_count: number | string;
  property_verified_count: number | string;
  property_recent_count: number | string;
  property_is_claimed: boolean;
  report_count: number | string;
  open_report_count: number | string;
  case_count: number | string;
}

/** One row of `livd_list_cases`. */
interface CaseRow {
  id: string;
  reference: string;
  status: CaseStatus;
  priority: CasePriority;
  category: string;
  summary: string;
  outcome: string | null;
  assigned_to: string | null;
  opened_by: string | null;
  subject_review_id: string | null;
  subject_user_id: string | null;
  subject_property_id: string | null;
  property_slug: string | null;
  building_name: string | null;
  street_address: string | null;
  neighbourhood: string | null;
  locality: string | null;
  admin_area: string | null;
  postal_code: string | null;
  country_code: string | null;
  report_count: number | string;
  note_count: number | string;
  preservation_hold: boolean;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  total_count: number | string;
}

/**
 * One case row, shaped once.
 *
 * Both the listing and the single-case read go through `livd_list_cases`, so
 * there is one query and one mapper — two screens cannot drift into disagreeing
 * about what a case is.
 */
function toCaseSummary(row: CaseRow): CaseSummary {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    priority: row.priority,
    category: row.category,
    summary: row.summary,
    outcome: row.outcome,
    assignedTo: row.assigned_to,
    openedBy: row.opened_by,
    subjectReviewId: row.subject_review_id,
    subjectUserId: row.subject_user_id,
    subjectPropertyId: row.subject_property_id,
    property:
      row.property_slug && row.locality && row.country_code
        ? {
            slug: row.property_slug,
            address: {
              buildingName: row.building_name,
              streetAddress: row.street_address,
              neighbourhood: row.neighbourhood,
              locality: row.locality,
              adminArea: row.admin_area,
              postalCode: row.postal_code,
              countryCode: row.country_code,
            },
          }
        : null,
    reportCount: Number(row.report_count ?? 0),
    noteCount: Number(row.note_count ?? 0),
    preservationHold: row.preservation_hold,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

/** One row of `livd_admin_audit_log`. */
interface AdminAuditRow {
  id: number | string;
  actor_id: string | null;
  actor_role: UserProfile['role'];
  action: string;
  subject_type: string;
  subject_id: string | null;
  outcome: 'succeeded' | 'denied' | 'failed';
  reason: string | null;
  detail: unknown;
  created_at: string;
  total_count: number | string;
}

/** One row of `livd_admin_audit_feed`. Carries a mask, never an address. */
interface AuditFeedRow {
  entry_id: string;
  source: 'audit' | 'moderation';
  actor_id: string | null;
  actor_role: UserProfile['role'] | null;
  actor_email_masked: string | null;
  action: string;
  raw_action: string;
  subject_type: string;
  subject_id: string | null;
  outcome: 'succeeded' | 'denied' | 'failed';
  reason: string | null;
  detail: unknown;
  created_at: string;
  total_count: number | string;
}

interface AuditSummaryRow {
  action: string;
  entries: number | string;
  actors: number | string;
  denials: number | string;
  last_at: string | null;
}

interface AuditActorRow {
  actor_id: string;
  actor_role: UserProfile['role'] | null;
  actor_email_masked: string | null;
  entries: number | string;
  denials: number | string;
  last_at: string | null;
}

/** One row of `livd_admin_user_directory`. Carries a mask, never an address. */
interface AdminUserDirectoryRow {
  id: string;
  masked_email: string;
  role: UserProfile['role'];
  status: UserProfile['status'];
  country_code: string | null;
  created_at: string;
  review_count: number | string;
  verified_review_count: number | string;
  reports_against: number | string;
  last_review_at: string | null;
  total_count: number | string;
}

/** One row of `livd_admin_user_detail`. */
interface AdminUserDetailRow {
  id: string;
  masked_email: string;
  role: UserProfile['role'];
  status: UserProfile['status'];
  country_code: string | null;
  preferred_locale: string;
  created_at: string;
  review_count: number | string;
  published_review_count: number | string;
  removed_review_count: number | string;
  held_review_count: number | string;
  verified_review_count: number | string;
  reports_against: number | string;
  reports_made: number | string;
  location_check_count: number | string;
  residency_submissions: number | string;
  last_review_at: string | null;
}

/** One row of `livd_admin_user_reviews`. */
interface AdminUserReviewRow {
  review_id: string;
  property_id: string;
  property_slug: string;
  building_name: string | null;
  street_address: string | null;
  neighbourhood: string | null;
  locality: string;
  admin_area: string | null;
  postal_code: string | null;
  country_code: string;
  overall_rating: number;
  residency_status: AdminUserReview['residencyStatus'];
  verification_level: AdminUserReview['verificationLevel'];
  status: AdminUserReview['status'];
  created_at: string;
  report_count: number | string;
  total_count: number | string;
}

/** One row of `livd_admin_user_reports`. */
interface AdminUserReportRow {
  report_id: string;
  review_id: string;
  reporter_id: string | null;
  reason: AdminUserReport['reason'];
  detail: string | null;
  status: AdminUserReport['status'];
  resolution: string | null;
  case_id: string | null;
  created_at: string;
  resolved_at: string | null;
  total_count: number | string;
}

export class SupabaseRepository implements LivdRepository {
  /**
   * Request-scoped client, carrying the caller's session.
   *
   * For anything user-specific: their saved properties, their own reviews,
   * their claims, and every write. RLS sees them as themselves.
   *
   * Must never be used inside `unstable_cache` — it reads cookies, which Next
   * forbids in a cached scope, and a per-user result has no business in a
   * shared cache anyway.
   */
  private async client(): Promise<SupabaseClient> {
    return createServerSupabaseClient();
  }

  /**
   * Cookie-free client for public reads.
   *
   * Everything a signed-out visitor may see: property pages, search,
   * discovery, published reviews. These are the queries that get cached and
   * shared between visitors, so they are evaluated with no user attached.
   */
  private publicClient(): SupabaseClient {
    return createAnonymousSupabaseClient();
  }

  /** Service role. Only for moderation paths that have already been authorised. */
  private admin(): SupabaseClient {
    return createServiceRoleClient();
  }

  /* ---------------------------------------------------------------------
   * Properties
   * ------------------------------------------------------------------ */

  async getPropertyBySlug(slug: string): Promise<Property | null> {
    const supabase = this.publicClient();
    const { data, error } = await supabase
      .from('properties')
      .select(PROPERTY_SELECT)
      .eq('slug', slug)
      .eq('status', 'active')
      .maybeSingle();

    if (error) throw new Error(`getPropertyBySlug: ${error.message}`);
    if (!data) return null;

    const property = toProperty(data as unknown as PropertyRow);
    return this.allowed(property) ? property : null;
  }

  async getPropertyById(id: string): Promise<Property | null> {
    const supabase = this.publicClient();
    const { data, error } = await supabase
      .from('properties')
      .select(PROPERTY_SELECT)
      .eq('id', id)
      .eq('status', 'active')
      .maybeSingle();

    if (error) throw new Error(`getPropertyById: ${error.message}`);
    if (!data) return null;

    const property = toProperty(data as unknown as PropertyRow);
    return this.allowed(property) ? property : null;
  }

  private allowed(property: Property): boolean {
    return showDemoData() || !property.isDemo;
  }

  async getPropertySummary(propertyId: string): Promise<PropertySummary | null> {
    const property = await this.getPropertyById(propertyId);
    if (!property) return null;
    return { property, intelligence: await this.getPropertyIntelligence(propertyId) };
  }

  async getPropertyIntelligence(propertyId: string): Promise<PropertyIntelligence> {
    const reviews = await this.fetchPublishedReviews(propertyId);
    if (reviews.length === 0) return emptyIntelligence(propertyId);
    return buildPropertyIntelligence(propertyId, reviews);
  }

  private async fetchPublishedReviews(propertyId: string): Promise<Review[]> {
    const supabase = this.publicClient();
    let query = supabase
      .from('reviews')
      .select(REVIEW_SELECT)
      .eq('property_id', propertyId)
      .eq('status', 'published');

    if (!showDemoData()) query = query.eq('is_demo', false);

    const { data, error } = await query;
    if (error) throw new Error(`fetchPublishedReviews: ${error.message}`);

    return (data ?? []).map((row) => toReview(row as unknown as ReviewRow, TAG_POLARITY));
  }

  async createProperty(input: CreatePropertyInput, createdBy: string): Promise<Property> {
    const supabase = await this.client();

    const slug = propertySlug({
      buildingName: input.buildingName,
      streetAddress: input.streetAddress,
      locality: input.locality,
      // A short discriminator from the outset avoids a collision round-trip on
      // the common case of two buildings sharing a street.
      discriminator: Math.random().toString(36).slice(2, 8),
    });

    const data = unwrap(
      await supabase
        .from('properties')
        .insert({
          slug,
          building_name: input.buildingName,
          street_address: input.streetAddress,
          neighbourhood: input.neighbourhood,
          locality: input.locality,
          admin_area: input.adminArea,
          postal_code: input.postalCode,
          country_code: input.countryCode.toUpperCase(),
          property_type: input.propertyType,
          // Rounded again by `properties_round_coordinates` (0003) whatever is
          // sent, so a coordinate is never unit-precise however precise the
          // geocoder was. Null is the ordinary case, not an error.
          latitude: input.coordinates?.latitude ?? null,
          longitude: input.coordinates?.longitude ?? null,
          status: 'active',
          created_by: createdBy,
        })
        .select(PROPERTY_SELECT)
        .single(),
      'createProperty',
    );

    return toProperty(data as unknown as PropertyRow);
  }

  async findDuplicateProperty(input: CreatePropertyInput): Promise<Property | null> {
    const supabase = await this.client();

    let query = supabase
      .from('properties')
      .select(PROPERTY_SELECT)
      .eq('country_code', input.countryCode.toUpperCase())
      .ilike('locality', input.locality)
      .eq('status', 'active');

    if (input.streetAddress) query = query.ilike('street_address', input.streetAddress);
    else query = query.is('street_address', null);

    if (input.buildingName) query = query.ilike('building_name', input.buildingName);

    const { data, error } = await query.limit(1);
    if (error) throw new Error(`findDuplicateProperty: ${error.message}`);

    const row = data?.[0];
    return row ? toProperty(row as unknown as PropertyRow) : null;
  }

  /* ---------------------------------------------------------------------
   * Search & discovery
   * ------------------------------------------------------------------ */

  async searchProperties(filters: SearchFilters): Promise<SearchResults> {
    const supabase = this.publicClient();
    const pageSize = LIMITS.searchPageSize;
    const page = Math.max(1, filters.page);

    let propertyIds: string[] | null = null;
    let allFuzzy = false;

    if (filters.query.trim().length > 0) {
      // `livd_property_search` combines tsvector rank with pg_trgm similarity,
      // so a misspelling still finds the property.
      const { data, error } = await supabase.rpc('livd_property_search', {
        search_query: filters.query.trim(),
        filter_country: filters.countryCode ?? null,
        result_limit: 200,
        result_offset: 0,
      });

      if (error) throw new Error(`searchProperties: ${error.message}`);

      const matches = (data ?? []) as Array<{ property_id: string; is_fuzzy: boolean }>;
      propertyIds = matches.map((m) => m.property_id);
      allFuzzy = matches.length > 0 && matches.every((m) => m.is_fuzzy);

      if (propertyIds.length === 0) {
        return { items: [], total: 0, page, pageSize, correctedFrom: null };
      }
    }

    let query = supabase
      .from('properties')
      .select(`${PROPERTY_SELECT}, property_stats!inner ( * )`, { count: 'exact' })
      .eq('status', 'active');

    if (propertyIds) query = query.in('id', propertyIds);
    if (filters.countryCode) query = query.eq('country_code', filters.countryCode.toUpperCase());
    if (filters.locality) query = query.ilike('locality', filters.locality);
    if (filters.propertyTypes.length > 0) query = query.in('property_type', filters.propertyTypes);
    if (!showDemoData()) query = query.eq('is_demo', false);
    if (filters.minScore !== null) query = query.gte('property_stats.overall_score', filters.minScore);
    if (filters.minReviews !== null) query = query.gte('property_stats.review_count', filters.minReviews);
    if (filters.verifiedOnly) query = query.gt('property_stats.verified_review_count', 0);

    // Ordering uses the denormalised rollup, so a page of results never loads
    // every review just to sort them.
    switch (filters.sort) {
      case 'score_desc':
        query = query.order('overall_score', {
          referencedTable: 'property_stats',
          ascending: false,
          nullsFirst: false,
        });
        break;
      case 'score_asc':
        query = query.order('overall_score', {
          referencedTable: 'property_stats',
          ascending: true,
          nullsFirst: false,
        });
        break;
      case 'reviews_desc':
        query = query.order('review_count', { referencedTable: 'property_stats', ascending: false });
        break;
      case 'recent':
        query = query.order('last_review_at', {
          referencedTable: 'property_stats',
          ascending: false,
          nullsFirst: false,
        });
        break;
      default:
        query = query.order('review_count', { referencedTable: 'property_stats', ascending: false });
    }

    const start = (page - 1) * pageSize;
    const { data, error, count } = await query.range(start, start + pageSize - 1);
    if (error) throw new Error(`searchProperties: ${error.message}`);

    const properties = (data ?? []).map((row) => toProperty(row as unknown as PropertyRow));
    const items = await this.summarise(properties);

    return {
      items,
      total: count ?? items.length,
      page,
      pageSize,
      correctedFrom: allFuzzy && items.length > 0 ? filters.query : null,
    };
  }

  /** Attaches intelligence to a page of properties in one round trip. */
  private async summarise(properties: Property[]): Promise<PropertySummary[]> {
    if (properties.length === 0) return [];

    const supabase = this.publicClient();
    let query = supabase
      .from('reviews')
      .select(REVIEW_SELECT)
      .in('property_id', properties.map((p) => p.id))
      .eq('status', 'published');

    if (!showDemoData()) query = query.eq('is_demo', false);

    const { data, error } = await query;
    if (error) throw new Error(`summarise: ${error.message}`);

    const byProperty = new Map<string, Review[]>();
    for (const row of data ?? []) {
      const review = toReview(row as unknown as ReviewRow, TAG_POLARITY);
      const bucket = byProperty.get(review.propertyId) ?? [];
      bucket.push(review);
      byProperty.set(review.propertyId, bucket);
    }

    return properties.map((property) => {
      const reviews = byProperty.get(property.id) ?? [];
      return {
        property,
        intelligence:
          reviews.length > 0
            ? buildPropertyIntelligence(property.id, reviews)
            : emptyIntelligence(property.id),
      };
    });
  }

  async suggest(query: string, limit: number): Promise<SearchSuggestion[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const supabase = this.publicClient();
    const { data, error } = await supabase.rpc('livd_property_search', {
      search_query: trimmed,
      filter_country: null,
      result_limit: limit * 2,
      result_offset: 0,
    });

    if (error) throw new Error(`suggest: ${error.message}`);

    const ids = ((data ?? []) as Array<{ property_id: string }>).map((m) => m.property_id);
    if (ids.length === 0) return [];

    const { data: rows, error: propertiesError } = await supabase
      .from('properties')
      .select(`${PROPERTY_SELECT}, property_stats ( review_count )`)
      .in('id', ids);

    if (propertiesError) throw new Error(`suggest: ${propertiesError.message}`);

    // The RPC already ranked these; restore that order after the id lookup.
    const order = new Map(ids.map((id, index) => [id, index]));

    return (rows ?? [])
      .map((row) => {
        const property = toProperty(row as unknown as PropertyRow);
        const stats = (row as unknown as { property_stats?: { review_count: number } | null })
          .property_stats;

        return {
          kind: 'property' as const,
          label: propertyDisplayName(property.address),
          sublabel: propertyContextLine(property.address),
          href: `/property/${property.slug}`,
          reviewCount: stats?.review_count ?? 0,
          _order: order.get(property.id) ?? 999,
        };
      })
      .sort((a, b) => a._order - b._order)
      .slice(0, limit)
      .map(({ _order: _ignored, ...suggestion }) => suggestion);
  }

  async recentlyReviewed(options: DiscoveryOptions = {}): Promise<PropertySummary[]> {
    return this.discover(options, 'last_review_at');
  }

  async mostReviewed(options: DiscoveryOptions = {}): Promise<PropertySummary[]> {
    return this.discover(options, 'review_count');
  }

  async highestRated(options: DiscoveryOptions = {}): Promise<PropertySummary[]> {
    // Moderate evidence at minimum — a "highest rated" list headed by
    // three-review properties is misleading however honestly the confidence is
    // labelled beside it.
    return this.discover(options, 'overall_score', { scoredOnly: true });
  }

  private async discover(
    options: DiscoveryOptions,
    orderColumn: string,
    { scoredOnly = false }: { scoredOnly?: boolean } = {},
  ): Promise<PropertySummary[]> {
    const supabase = this.publicClient();

    let query = supabase
      .from('properties')
      .select(`${PROPERTY_SELECT}, property_stats!inner ( * )`)
      .eq('status', 'active')
      .gt('property_stats.review_count', 0);

    if (options.countryCode) query = query.eq('country_code', options.countryCode.toUpperCase());
    if (!showDemoData()) query = query.eq('is_demo', false);
    if (scoredOnly) {
      query = query
        .not('property_stats.overall_score', 'is', null)
        .in('property_stats.confidence', ['moderate', 'strong']);
    }

    const { data, error } = await query
      .order(orderColumn, { referencedTable: 'property_stats', ascending: false, nullsFirst: false })
      .limit(options.limit ?? 6);

    if (error) throw new Error(`discover: ${error.message}`);

    return this.summarise((data ?? []).map((row) => toProperty(row as unknown as PropertyRow)));
  }

  async listLocalities(countryCode?: string | null): Promise<LocalitySummary[]> {
    const supabase = this.publicClient();

    let query = supabase
      .from('properties')
      .select(`country_code, locality, admin_area, property_stats ( review_count )`)
      .eq('status', 'active');

    if (countryCode) query = query.eq('country_code', countryCode.toUpperCase());
    if (!showDemoData()) query = query.eq('is_demo', false);

    const { data, error } = await query;
    if (error) throw new Error(`listLocalities: ${error.message}`);

    const localities = new Map<string, LocalitySummary>();

    // A to-one embed is still typed as an array by the client's generic types,
    // so it is normalised here rather than trusted to be an object.
    for (const row of (data ?? []) as unknown as Array<{
      country_code: string;
      locality: string;
      admin_area: string | null;
      property_stats: { review_count: number } | Array<{ review_count: number }> | null;
    }>) {
      const key = `${row.country_code}:${row.locality}`;
      const stats = Array.isArray(row.property_stats)
        ? row.property_stats[0]
        : row.property_stats;
      const reviewCount = stats?.review_count ?? 0;
      const existing = localities.get(key);

      if (existing) {
        existing.propertyCount += 1;
        existing.reviewCount += reviewCount;
      } else {
        localities.set(key, {
          countryCode: row.country_code,
          locality: row.locality,
          adminArea: row.admin_area,
          propertyCount: 1,
          reviewCount,
          href: `/places/${row.country_code.toLowerCase()}/${encodeURIComponent(
            row.locality.toLowerCase(),
          )}`,
        });
      }
    }

    return [...localities.values()].sort(
      (a, b) => b.reviewCount - a.reviewCount || a.locality.localeCompare(b.locality),
    );
  }

  async propertiesInLocality(countryCode: string, locality: string): Promise<PropertySummary[]> {
    const supabase = this.publicClient();

    let query = supabase
      .from('properties')
      .select(PROPERTY_SELECT)
      .eq('country_code', countryCode.toUpperCase())
      .ilike('locality', locality)
      .eq('status', 'active');

    if (!showDemoData()) query = query.eq('is_demo', false);

    const { data, error } = await query;
    if (error) throw new Error(`propertiesInLocality: ${error.message}`);

    const summaries = await this.summarise(
      (data ?? []).map((row) => toProperty(row as unknown as PropertyRow)),
    );
    return summaries.sort((a, b) => b.intelligence.reviewCount - a.intelligence.reviewCount);
  }

  /* ---------------------------------------------------------------------
   * Reviews
   * ------------------------------------------------------------------ */

  async listPublicReviews(
    propertyId: string,
    options: ReviewListOptions = {},
  ): Promise<ReviewListResult> {
    const supabase = this.publicClient();
    const pageSize = options.pageSize ?? LIMITS.reviewsPerPage;
    const page = Math.max(1, options.page ?? 1);

    let query = supabase
      .from('reviews')
      .select(REVIEW_SELECT, { count: 'exact' })
      .eq('property_id', propertyId)
      .eq('status', 'published');

    if (options.residency && options.residency !== 'all') {
      query = query.eq('residency_status', options.residency);
    }
    if (options.verifiedOnly) {
      // "Verified" in the interface means any level of verification. A filter
      // labelled verified that silently excluded location-verified reviews
      // would be a lie in the UI rather than a subtlety in the query.
      query = query.in('verification_level', ['verified_resident', 'location_verified']);
    }
    if (!showDemoData()) query = query.eq('is_demo', false);

    switch (options.sort ?? 'recent') {
      case 'helpful':
        query = query.order('helpful_count', { ascending: false });
        break;
      case 'highest':
        query = query.order('overall_rating', { ascending: false });
        break;
      case 'lowest':
        query = query.order('overall_rating', { ascending: true });
        break;
      default:
        query = query.order('created_at', { ascending: false });
    }

    const start = (page - 1) * pageSize;
    const { data, error, count } = await query.range(start, start + pageSize - 1);
    if (error) throw new Error(`listPublicReviews: ${error.message}`);

    const reviews = (data ?? []).map((row) => toReview(row as unknown as ReviewRow, TAG_POLARITY));

    const { data: responses } = await supabase
      .from('owner_responses')
      .select('id, review_id, body, is_resolution_notice, created_at, property_claims!inner(role_claimed)')
      .in('review_id', reviews.map((r) => r.id))
      .eq('status', 'published');

    const responsesByReview = new Map(
      ((responses ?? []) as Array<{
        id: string;
        review_id: string;
        body: string;
        is_resolution_notice: boolean;
        created_at: string;
      }>).map((row) => [
        row.review_id,
        {
          id: row.id,
          reviewId: row.review_id,
          body: row.body,
          isResolutionNotice: row.is_resolution_notice,
          respondentRole: 'manager' as const,
          createdAt: row.created_at,
        },
      ]),
    );

    return {
      items: reviews.map((review) => toPublicReview(review, responsesByReview.get(review.id) ?? null)),
      total: count ?? reviews.length,
      page,
      pageSize,
    };
  }

  async getReviewById(id: string): Promise<Review | null> {
    const supabase = await this.client();
    const { data, error } = await supabase
      .from('reviews')
      .select(REVIEW_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(`getReviewById: ${error.message}`);
    return data ? toReview(data as unknown as ReviewRow, TAG_POLARITY) : null;
  }

  async listReviewsByAuthor(authorId: string): Promise<Review[]> {
    const supabase = await this.client();
    const { data, error } = await supabase
      .from('reviews')
      .select(REVIEW_SELECT)
      .eq('author_id', authorId)
      .neq('status', 'removed')
      .order('created_at', { ascending: false });

    if (error) throw new Error(`listReviewsByAuthor: ${error.message}`);
    return (data ?? []).map((row) => toReview(row as unknown as ReviewRow, TAG_POLARITY));
  }

  async createReview(input: CreateReviewInput, authorId: string): Promise<Review> {
    const supabase = await this.client();
    const tenureMonths = monthsBetween(input.movedInMonth, input.movedOutMonth);

    const inserted = unwrap(
      await supabase
        .from('reviews')
        .insert({
          property_id: input.propertyId,
          author_id: authorId,
          residency_status: input.residencyStatus,
          moved_in_month: input.movedInMonth,
          moved_out_month: input.movedOutMonth,
          tenure_months: tenureMonths,
          overall_rating: input.overallRating,
          body: input.body,
          would_recommend: input.wouldRecommend,
          rent_amount_minor: input.rentAmountMinor,
          rent_currency: input.rentCurrency,
          rent_period: input.rentPeriod,
          noticed_management_change: input.noticedManagementChange,
          status: input.status,
          safety_flags: input.safetyFlags,
          // An id, never a level. `livd_derive_review_verification` (0014)
          // resolves it to a level after checking the verification belongs to
          // this author and this property, and refuses the insert if it does
          // not. Sending `verification_level` from here would be sending it
          // from the browser's session — which is exactly what that trigger
          // exists to disregard.
          verification_id: input.verificationId,
        })
        .select('id')
        .single(),
      'createReview',
    );

    const reviewId = (inserted as unknown as { id: string }).id;

    // Child rows. Postgres has no multi-table insert, so these are separate
    // statements; each is idempotent on the review's primary key, and a failure
    // leaves a review with fewer facets rather than a corrupted one.
    if (input.categoryRatings.length > 0) {
      const { error } = await supabase.from('review_category_ratings').insert(
        input.categoryRatings.map((rating) => ({
          review_id: reviewId,
          category_key: rating.categoryKey,
          rating: rating.rating,
        })),
      );
      if (error) throw new Error(`createReview categories: ${error.message}`);
    }

    const departureRows = [
      ...(input.primaryDepartureReason
        ? [{ review_id: reviewId, reason_key: input.primaryDepartureReason, is_primary: true }]
        : []),
      ...input.secondaryDepartureReasons
        .filter((key) => key !== input.primaryDepartureReason)
        .map((key) => ({ review_id: reviewId, reason_key: key, is_primary: false })),
    ];

    if (departureRows.length > 0) {
      const { error } = await supabase.from('review_departure_reasons').insert(departureRows);
      if (error) throw new Error(`createReview departures: ${error.message}`);
    }

    const tagRows = [...new Set([...input.positiveTags, ...input.problemTags])].map((tagKey) => ({
      review_id: reviewId,
      tag_key: tagKey,
    }));

    if (tagRows.length > 0) {
      const { error } = await supabase.from('review_tags').insert(tagRows);
      if (error) throw new Error(`createReview tags: ${error.message}`);
    }

    const created = await this.getReviewById(reviewId);
    if (!created) throw new Error('createReview: review not readable after insert');
    return created;
  }

  async updateReview(
    id: string,
    authorId: string,
    patch: Partial<Pick<CreateReviewInput, 'body' | 'wouldRecommend'>>,
  ): Promise<Review> {
    const supabase = await this.client();

    // RLS enforces both authorship and the edit window; this is the friendly
    // error rather than the control.
    const { error } = await supabase
      .from('reviews')
      .update({
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.wouldRecommend !== undefined ? { would_recommend: patch.wouldRecommend } : {}),
      })
      .eq('id', id)
      .eq('author_id', authorId);

    if (error) throw new Error(`updateReview: ${error.message}`);

    const updated = await this.getReviewById(id);
    if (!updated) throw new Error('updateReview: review not found');
    return updated;
  }

  async hasExistingReview(
    propertyId: string,
    authorId: string,
    movedInMonth: string,
  ): Promise<boolean> {
    const supabase = await this.client();
    const year = movedInMonth.slice(0, 4);

    const { data, error } = await supabase
      .from('reviews')
      .select('id, moved_in_month')
      .eq('property_id', propertyId)
      .eq('author_id', authorId)
      .neq('status', 'removed');

    if (error) throw new Error(`hasExistingReview: ${error.message}`);

    return (data ?? []).some(
      (row) => (row as { moved_in_month: string }).moved_in_month.slice(0, 4) === year,
    );
  }

  async markReviewHelpful(reviewId: string, userId: string): Promise<number> {
    const supabase = await this.client();

    const { data: existing } = await supabase
      .from('review_helpful_votes')
      .select('review_id')
      .eq('review_id', reviewId)
      .eq('voter_id', userId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('review_helpful_votes')
        .delete()
        .eq('review_id', reviewId)
        .eq('voter_id', userId);
    } else {
      await supabase
        .from('review_helpful_votes')
        .insert({ review_id: reviewId, voter_id: userId });
    }

    // The counter is maintained by trigger; read it back rather than guessing.
    const { data } = await supabase
      .from('reviews')
      .select('helpful_count')
      .eq('id', reviewId)
      .maybeSingle();

    return (data as { helpful_count: number } | null)?.helpful_count ?? 0;
  }

  /* ---------------------------------------------------------------------
   * Moderation — through the caller's own session, never the service role
   *
   * These four used to be service-role UPDATEs followed by a separate INSERT
   * into `moderation_actions`, and the insert's error was never examined:
   *
   *     const { error } = await admin.from('reviews').update({ status })...
   *     if (error) throw ...
   *
   *     await admin.from('moderation_actions').insert({ ... });   // unchecked
   *
   * So a failed record left a review removed with nothing anywhere saying who
   * removed it or why, and the operation reported success. Two statements
   * rather than one meant a process dying in between produced the same result
   * on a good day.
   *
   * 0035 moved all four into the database, where the change and the entry that
   * explains it are one statement block. The actor comes from `auth.uid()`
   * rather than from an argument, and `livd_is_moderator()` is checked there
   * rather than only in a Server Action — PostgREST does not run Server
   * Actions.
   *
   * `actorId` is unused as a result, and kept in the signature for the local
   * adapter, which has no session. Same asymmetry as `setUserRole`.
   * ------------------------------------------------------------------ */

  async setReviewStatus(
    reviewId: string,
    status: ReviewStatus,
    _actorId: string,
    reason: string,
  ): Promise<void> {
    const supabase = await this.client();

    const { error } = await supabase.rpc('livd_set_review_status', {
      target_review: reviewId,
      new_status: status,
      why: reason,
    });

    if (error) throw new Error(`setReviewStatus: ${error.message}`);
  }

  /**
   * As `setReviewStatus`, for how much a review counts rather than whether it
   * is visible. A reason is required since 0035.
   */
  async setReviewVerification(
    reviewId: string,
    level: VerificationLevel,
    _actorId: string,
    reason: string,
  ): Promise<void> {
    const supabase = await this.client();

    const { error } = await supabase.rpc('livd_set_review_verification', {
      target_review: reviewId,
      new_level: level,
      why: reason,
    });

    if (error) throw new Error(`setReviewVerification: ${error.message}`);
  }

  async listReviewsByStatus(
    status: ReviewStatus,
    limit = 50,
  ): Promise<Array<{ review: Review; property: Property }>> {
    const admin = this.admin();

    const { data, error } = await admin
      .from('reviews')
      .select(`${REVIEW_SELECT}, properties!inner ( ${PROPERTY_SELECT} )`)
      .eq('status', status)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) throw new Error(`listReviewsByStatus: ${error.message}`);

    return (data ?? []).map((row) => ({
      review: toReview(row as unknown as ReviewRow, TAG_POLARITY),
      property: toProperty((row as unknown as { properties: PropertyRow }).properties),
    }));
  }

  async createReport(input: {
    reviewId: string;
    reporterId: string;
    reason: ReviewReport['reason'];
    detail: string | null;
  }): Promise<ReviewReport> {
    const supabase = await this.client();

    const { data, error } = await supabase
      .from('review_reports')
      .upsert(
        {
          review_id: input.reviewId,
          reporter_id: input.reporterId,
          reason: input.reason,
          detail: input.detail,
        },
        { onConflict: 'review_id,reporter_id', ignoreDuplicates: false },
      )
      .select('*')
      .single();

    if (error) throw new Error(`createReport: ${error.message}`);
    return toReport(data as unknown as ReportRow);
  }

  async listReports(
    status?: ReportStatus,
  ): Promise<Array<{ report: ReviewReport; review: Review; property: Property }>> {
    const admin = this.admin();

    let query = admin
      .from('review_reports')
      .select(`*, reviews!inner ( ${REVIEW_SELECT}, properties!inner ( ${PROPERTY_SELECT} ) )`)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw new Error(`listReports: ${error.message}`);

    return (data ?? []).map((row) => {
      const typed = row as unknown as ReportRow & {
        reviews: ReviewRow & { properties: PropertyRow };
      };
      return {
        report: toReport(typed),
        review: toReview(typed.reviews, TAG_POLARITY),
        property: toProperty(typed.reviews.properties),
      };
    });
  }

  /* ---------------------------------------------------------------------
   * Property verification (location)
   *
   * The one place in this adapter where the decision is not made in
   * TypeScript. `livd_verify_property_location` (migration 0014) takes the
   * position as arguments, does the arithmetic and writes the verdict, which
   * is what makes it impossible for a caller to assert one — and what lets the
   * feature work on a deployment with no service-role key, because the
   * function is SECURITY DEFINER and the table beneath it has no write policy
   * for any client role.
   * ------------------------------------------------------------------ */

  async getVerificationStanding(
    userId: string,
    propertyId: string,
  ): Promise<VerificationStanding> {
    const supabase = await this.client();

    // Coordinates are public property data, so this read needs no session.
    const { data: property } = await this.publicClient()
      .from('properties')
      .select('latitude, longitude')
      .eq('id', propertyId)
      .maybeSingle();

    const coordinates = property as { latitude: number | null; longitude: number | null } | null;

    const { data, error } = await supabase
      .from('property_verifications')
      .select(PROPERTY_VERIFICATION_SELECT)
      .eq('user_id', userId)
      .eq('property_id', propertyId)
      .eq('status', 'verified')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) throw new Error(`getVerificationStanding: ${error.message}`);

    const rows = (data ?? []) as unknown as PropertyVerificationRow[];

    return {
      canVerifyLocation:
        typeof coordinates?.latitude === 'number' && typeof coordinates?.longitude === 'number',
      activeVerification: rows[0] ? toPropertyVerification(rows[0]) : null,
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
    const supabase = await this.client();

    // The caller's own session, not the service role. RLS and the function's
    // own `auth.uid()` check are what tie the resulting row to this person;
    // `input.userId` only labels the object that comes back.
    const { data, error } = await supabase.rpc('livd_verify_property_location', {
      target_property_id: input.propertyId,
      reported_latitude: input.latitude,
      reported_longitude: input.longitude,
      reported_accuracy_meters: input.accuracyMeters,
      fix_captured_at: new Date(input.capturedAtMs).toISOString(),
    });

    if (error) throw new Error(`verifyPropertyLocation: ${error.message}`);

    const row = (Array.isArray(data) ? data[0] : data) as
      | {
          verification_id: string;
          status: PropertyVerification['status'];
          failure_reason: PropertyVerification['failureReason'];
          expires_at: string | null;
        }
      | undefined;

    if (!row) throw new Error('verifyPropertyLocation: no verdict returned');

    return {
      id: row.verification_id,
      userId: input.userId,
      propertyId: input.propertyId,
      method: 'location',
      status: row.status,
      failureReason: row.failure_reason,
      expiresAt: row.expires_at ?? new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  }

  async listPropertyVerifications(
    userId: string,
    limit = 20,
  ): Promise<PropertyVerification[]> {
    const supabase = await this.client();

    const { data, error } = await supabase
      .from('property_verifications')
      .select(PROPERTY_VERIFICATION_SELECT)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`listPropertyVerifications: ${error.message}`);
    return ((data ?? []) as unknown as PropertyVerificationRow[]).map(toPropertyVerification);
  }

  async listRecentVerificationAttempts(
    limit = 50,
  ): Promise<Array<{ verification: PropertyVerification; property: Property }>> {
    // The caller's own session, not the service role: RLS grants this select
    // to moderators only, so an ordinary account reading through here sees its
    // own rows and nothing else even if a guard above were ever forgotten.
    const supabase = await this.client();

    const { data, error } = await supabase
      .from('property_verifications')
      .select(PROPERTY_VERIFICATION_SELECT)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`listRecentVerificationAttempts: ${error.message}`);

    const rows = (data ?? []) as unknown as PropertyVerificationRow[];
    const propertyIds = [...new Set(rows.map((row) => row.property_id))];
    if (propertyIds.length === 0) return [];

    const { data: properties } = await this.publicClient()
      .from('properties')
      .select(PROPERTY_SELECT)
      .in('id', propertyIds);

    const byId = new Map(
      ((properties ?? []) as unknown as PropertyRow[]).map((row) => [row.id, toProperty(row)]),
    );

    return rows.flatMap((row) => {
      const property = byId.get(row.property_id);
      return property ? [{ verification: toPropertyVerification(row), property }] : [];
    });
  }

  async propertiesNear(input: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
    limit?: number;
  }): Promise<NearbyProperty[]> {
    // No session: this is public property data, the result is shareable
    // between visitors, and attaching a user to it would be attaching a person
    // to a position.
    const supabase = this.publicClient();

    const { data, error } = await supabase.rpc('livd_properties_near', {
      origin_latitude: input.latitude,
      origin_longitude: input.longitude,
      radius_meters: input.radiusMeters,
      result_limit: input.limit ?? 12,
    });

    if (error) throw new Error(`propertiesNear: ${error.message}`);

    const rows = (data ?? []) as Array<{ property_id: string; distance_meters: number }>;
    if (rows.length === 0) return [];

    const { data: properties } = await supabase
      .from('properties')
      .select(PROPERTY_SELECT)
      .in(
        'id',
        rows.map((row) => row.property_id),
      );

    const summaries = await this.summarise(
      ((properties ?? []) as unknown as PropertyRow[]).map(toProperty),
    );
    const byId = new Map(summaries.map((summary) => [summary.property.id, summary]));

    return rows.flatMap((row) => {
      const summary = byId.get(row.property_id);
      return summary
        ? [
            {
              summary,
              // Rounded before it leaves the data layer: a metre-precise
              // distance to a known building is a position.
              distanceMeters: Math.round(Number(row.distance_meters) / 10) * 10,
            },
          ]
        : [];
    });
  }

  /* ---------------------------------------------------------------------
   * Residency verification
   * ------------------------------------------------------------------ */

  async gatherVerificationContext(input: {
    reviewId: string;
    submitterId: string;
    evidenceSha256: string;
  }) {
    const admin = this.admin();

    const review = await this.getReviewById(input.reviewId);
    if (!review || review.authorId !== input.submitterId) return null;

    const property = await this.getPropertyById(review.propertyId);
    if (!property) return null;

    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

    const [profile, claimed, priors, recent] = await Promise.all([
      admin.from('profiles').select('created_at').eq('id', input.submitterId).maybeSingle(),
      // An owner cannot verify themselves as a resident of their own building.
      admin
        .from('property_claims')
        .select('id')
        .eq('property_id', review.propertyId)
        .eq('claimant_id', input.submitterId)
        .eq('status', 'approved')
        .maybeSingle(),
      // The same document, offered before — by anyone.
      admin
        .from('verification_records')
        .select('submitted_by')
        .eq('evidence_sha256', input.evidenceSha256),
      admin
        .from('verification_records')
        .select('*', { count: 'exact', head: true })
        .eq('submitted_by', input.submitterId)
        .gte('created_at', weekAgo),
    ]);

    return {
      review,
      property,
      submitterCreatedAt:
        (profile.data as { created_at?: string } | null)?.created_at ?? new Date().toISOString(),
      submitterOwnsProperty: Boolean(claimed.data),
      priorSubmitterIds: ((priors.data ?? []) as Array<{ submitted_by: string | null }>)
        .map((row) => row.submitted_by)
        .filter((id): id is string => Boolean(id)),
      recentSubmissionCount: recent.count ?? 0,
    };
  }

  async recordVerificationSubmission(input: {
    reviewId: string;
    submitterId: string;
    method: VerificationMethod;
    checks: VerificationCheck[];
    file: { data: Uint8Array; type: string; bytes: number; sha256: string };
  }): Promise<VerificationRecord> {
    const admin = this.admin();

    // An opaque key. Nothing in it identifies the property, the reviewer or the
    // review — a bucket listing should say nothing even to whoever can list it.
    const key = crypto.randomUUID();

    const uploaded = await admin.storage
      .from(EVIDENCE_BUCKET)
      .upload(key, input.file.data, { contentType: input.file.type, upsert: false });

    if (uploaded.error) {
      throw new Error(`verification upload: ${uploaded.error.message}`);
    }

    const { data, error } = await admin
      .from('verification_records')
      .insert({
        subject_type: 'review',
        subject_id: input.reviewId,
        submitted_by: input.submitterId,
        method: input.method,
        evidence_ref: key,
        evidence_sha256: input.file.sha256,
        evidence_mime: input.file.type,
        evidence_bytes: input.file.bytes,
        checks: input.checks,
        outcome: 'pending',
      })
      .select('*')
      .single();

    if (error || !data) {
      // The row is the record. An object with no row pointing at it is
      // unreachable, and would sit in the bucket forever.
      await admin.storage.from(EVIDENCE_BUCKET).remove([key]);
      throw new Error(`recordVerificationSubmission: ${error?.message ?? 'no row returned'}`);
    }

    return toVerificationRecord(data as unknown as VerificationRecordRow);
  }

  async listPendingVerifications() {
    const admin = this.admin();

    const { data, error } = await admin
      .from('verification_records')
      .select('*')
      .eq('outcome', 'pending')
      .eq('subject_type', 'review')
      .order('created_at', { ascending: true });

    if (error) throw new Error(`listPendingVerifications: ${error.message}`);

    const rows = (data ?? []) as unknown as VerificationRecordRow[];

    const entries = await Promise.all(
      rows.map(async (row) => {
        const review = await this.getReviewById(row.subject_id);
        if (!review) return null;
        const property = await this.getPropertyById(review.propertyId);
        if (!property) return null;
        return { record: toVerificationRecord(row), review, property };
      }),
    );

    return entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }

  async listVerificationsForReview(reviewId: string): Promise<VerificationRecord[]> {
    const admin = this.admin();

    const { data, error } = await admin
      .from('verification_records')
      .select('*')
      .eq('subject_type', 'review')
      .eq('subject_id', reviewId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`listVerificationsForReview: ${error.message}`);
    return ((data ?? []) as unknown as VerificationRecordRow[]).map(toVerificationRecord);
  }

  async decideVerification(
    recordId: string,
    outcome: Extract<VerificationOutcome, 'approved' | 'rejected'>,
    actorId: string,
    notes: string,
  ): Promise<void> {
    const admin = this.admin();

    const { data, error } = await admin
      .from('verification_records')
      .update({ outcome, reviewed_by: actorId, notes, decided_at: new Date().toISOString() })
      .eq('id', recordId)
      .eq('outcome', 'pending')
      .select('subject_id')
      .single();

    if (error || !data) {
      throw new Error(`decideVerification: ${error?.message ?? 'no pending record'}`);
    }

    const reviewId = (data as unknown as { subject_id: string }).subject_id;

    if (outcome === 'approved') {
      // Rejection deliberately does not mark the review disputed. Failing to
      // produce a document is not evidence of having lied.
      //
      // The reason names the record this came from, so the verification entry
      // in the trail can be traced back to a document somebody approved rather
      // than looking like an unexplained manual override.
      await this.setReviewVerification(
        reviewId,
        'verified_resident',
        actorId,
        `Residency verification ${recordId} approved.`,
      );
    }

    await this.recordModerationAction({
      actorId,
      subjectType: 'review',
      subjectId: reviewId,
      action: `verification_${outcome}`,
      reason: notes,
      previousStatus: 'pending',
      newStatus: outcome,
    });
  }

  async createVerificationEvidenceLink(recordId: string): Promise<string | null> {
    const admin = this.admin();

    const { data } = await admin
      .from('verification_records')
      .select('evidence_ref')
      .eq('id', recordId)
      .maybeSingle();

    const key = (data as { evidence_ref?: string | null } | null)?.evidence_ref;
    if (!key) return null;

    // Minutes, not hours. Long enough to read a document, short enough that a
    // link pasted into a chat window is worth nothing by the time anyone tries it.
    const signed = await admin.storage
      .from(EVIDENCE_BUCKET)
      .createSignedUrl(key, EVIDENCE_LINK_SECONDS);

    return signed.data?.signedUrl ?? null;
  }

  /* ---------------------------------------------------------------------
   * Automated signals
   * ------------------------------------------------------------------ */

  /**
   * Reads what the detector found.
   *
   * The rows are written by `livd_detect_property_flags`, which pg_cron runs
   * hourly — see migrations 0010 and 0011. Nothing in the application writes
   * them, and nothing acts on them: a flag exists to put a property in front
   * of a person.
   */
  async listPropertyFlags(
    status: PropertyFlagStatus = 'open',
  ): Promise<Array<{ flag: PropertyFlag; property: Property }>> {
    const admin = this.admin();

    const { data, error } = await admin
      .from('property_flags')
      .select(`*, properties!inner ( ${PROPERTY_SELECT} )`)
      .eq('status', status)
      .order('severity', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw new Error(`listPropertyFlags: ${error.message}`);

    return (data ?? []).map((row) => {
      const typed = row as unknown as PropertyFlagRow & { properties: PropertyRow };
      return {
        flag: toPropertyFlag(typed),
        property: toProperty(typed.properties),
      };
    });
  }

  async decidePropertyFlag(
    flagId: string,
    status: Extract<PropertyFlagStatus, 'reviewed' | 'dismissed'>,
    actorId: string,
  ): Promise<void> {
    const admin = this.admin();

    const { data, error } = await admin
      .from('property_flags')
      .update({ status, reviewed_by: actorId, reviewed_at: new Date().toISOString() })
      .eq('id', flagId)
      .select('property_id, kind')
      .single();

    if (error) throw new Error(`decidePropertyFlag: ${error.message}`);

    const decided = data as unknown as { property_id: string; kind: string };

    await this.recordModerationAction({
      actorId,
      subjectType: 'property',
      subjectId: decided.property_id,
      action: `flag_${status}:${decided.kind}`,
      reason: null,
      previousStatus: 'open',
      newStatus: status,
    });
  }

  async resolveReport(
    reportId: string,
    status: Extract<ReportStatus, 'upheld' | 'dismissed'>,
    _actorId: string,
    resolution: string,
  ): Promise<void> {
    const supabase = await this.client();

    // Resolving a report does not touch the review it concerns. Removal is a
    // separate act with its own reason, so a coordinated reporting campaign
    // cannot mechanically produce one.
    const { error } = await supabase.rpc('livd_resolve_report', {
      target_report: reportId,
      new_status: status,
      why: resolution,
    });

    if (error) throw new Error(`resolveReport: ${error.message}`);
  }

  async recordModerationAction(
    input: Omit<ModerationAction, 'id' | 'createdAt'>,
  ): Promise<ModerationAction> {
    const admin = this.admin();

    // The role at the time, read now rather than at display time. This is the
    // last app-side writer to `moderation_actions`; the four moderation
    // decisions moved into the database in 0035 and stamp it there.
    const { data: actor } = await admin
      .from('profiles')
      .select('role')
      .eq('id', input.actorId ?? '')
      .maybeSingle();

    const data = unwrap(
      await admin
        .from('moderation_actions')
        .insert({
          actor_id: input.actorId,
          actor_role: (actor as { role: UserProfile['role'] } | null)?.role ?? null,
          subject_type: input.subjectType,
          subject_id: input.subjectId,
          action: input.action,
          reason: input.reason,
          previous_status: input.previousStatus,
          new_status: input.newStatus,
        })
        .select('*')
        .single(),
      'recordModerationAction',
    );

    return toModerationAction(data as unknown as ModerationActionRow);
  }

  async listModerationActions(subjectId?: string, limit = 50): Promise<ModerationAction[]> {
    const admin = this.admin();

    let query = admin
      .from('moderation_actions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (subjectId) query = query.eq('subject_id', subjectId);

    const { data, error } = await query;
    if (error) throw new Error(`listModerationActions: ${error.message}`);

    return (data ?? []).map((row) => toModerationAction(row as unknown as ModerationActionRow));
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
    const supabase = await this.client();

    const data = unwrap(
      await supabase
        .from('property_claims')
        .insert({
          property_id: input.propertyId,
          claimant_id: input.claimantId,
          role_claimed: input.roleClaimed,
          organisation: input.organisation,
          contact_email: input.contactEmail,
          status: 'pending',
        })
        .select('*')
        .single(),
      'createClaim',
    );

    return toClaim(data as unknown as ClaimRow);
  }

  async listClaims(
    status?: ClaimStatus,
  ): Promise<Array<{ claim: PropertyClaim; property: Property }>> {
    const admin = this.admin();

    let query = admin
      .from('property_claims')
      .select(`*, properties!inner ( ${PROPERTY_SELECT} )`)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw new Error(`listClaims: ${error.message}`);

    return (data ?? []).map((row) => {
      const typed = row as unknown as ClaimRow & { properties: PropertyRow };
      return { claim: toClaim(typed), property: toProperty(typed.properties) };
    });
  }

  async decideClaim(
    claimId: string,
    status: Extract<ClaimStatus, 'approved' | 'rejected'>,
    _actorId: string,
    reason: string,
  ): Promise<void> {
    const supabase = await this.client();

    const { error } = await supabase.rpc('livd_decide_claim', {
      target_claim: claimId,
      new_status: status,
      why: reason,
    });

    if (error) throw new Error(`decideClaim: ${error.message}`);
  }

  async getApprovedClaim(propertyId: string): Promise<PropertyClaim | null> {
    const supabase = await this.client();
    const { data, error } = await supabase
      .from('property_claims')
      .select('*')
      .eq('property_id', propertyId)
      .eq('status', 'approved')
      .maybeSingle();

    if (error) throw new Error(`getApprovedClaim: ${error.message}`);
    return data ? toClaim(data as unknown as ClaimRow) : null;
  }

  async isPropertyClaimed(propertyId: string): Promise<boolean> {
    // Reads the public rollup, not property_claims — see migration 0007. The
    // claims table is readable only by the claimant and by moderators, so a
    // signed-out visitor querying it would see every property as unclaimed.
    const supabase = this.publicClient();
    const { data, error } = await supabase
      .from('property_stats')
      .select('is_claimed')
      .eq('property_id', propertyId)
      .maybeSingle();

    if (error) throw new Error(`isPropertyClaimed: ${error.message}`);
    return (data as { is_claimed: boolean } | null)?.is_claimed ?? false;
  }

  async listClaimedPropertyIds(userId: string): Promise<string[]> {
    const supabase = await this.client();
    const { data, error } = await supabase
      .from('property_claims')
      .select('property_id')
      .eq('claimant_id', userId)
      .eq('status', 'approved');

    if (error) throw new Error(`listClaimedPropertyIds: ${error.message}`);
    return (data ?? []).map((row) => (row as { property_id: string }).property_id);
  }

  async createOwnerResponse(input: {
    reviewId: string;
    responderId: string;
    body: string;
    isResolutionNotice: boolean;
  }): Promise<void> {
    const supabase = await this.client();

    const review = await this.getReviewById(input.reviewId);
    if (!review) throw new Error('Review not found');

    const { error } = await supabase.from('owner_responses').insert({
      review_id: input.reviewId,
      property_id: review.propertyId,
      responder_id: input.responderId,
      body: input.body,
      is_resolution_notice: input.isResolutionNotice,
    });

    // RLS is what actually restricts this to the approved claimant.
    if (error) throw new Error(`createOwnerResponse: ${error.message}`);
  }

  /* ---------------------------------------------------------------------
   * Saved properties
   * ------------------------------------------------------------------ */

  async listSavedProperties(
    userId: string,
  ): Promise<Array<SavedProperty & { summary: PropertySummary }>> {
    const supabase = await this.client();

    const { data, error } = await supabase
      .from('saved_properties')
      .select(`user_id, property_id, note, created_at, properties!inner ( ${PROPERTY_SELECT} )`)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`listSavedProperties: ${error.message}`);

    const rows = (data ?? []) as unknown as Array<{
      user_id: string;
      property_id: string;
      note: string | null;
      created_at: string;
      properties: PropertyRow;
    }>;

    const summaries = await this.summarise(rows.map((row) => toProperty(row.properties)));
    const byId = new Map(summaries.map((summary) => [summary.property.id, summary]));

    return rows.flatMap((row) => {
      const summary = byId.get(row.property_id);
      return summary
        ? [
            {
              userId: row.user_id,
              propertyId: row.property_id,
              note: row.note,
              createdAt: row.created_at,
              summary,
            },
          ]
        : [];
    });
  }

  async saveProperty(userId: string, propertyId: string): Promise<void> {
    const supabase = await this.client();
    const { error } = await supabase
      .from('saved_properties')
      .upsert({ user_id: userId, property_id: propertyId }, { onConflict: 'user_id,property_id' });

    if (error) throw new Error(`saveProperty: ${error.message}`);
  }

  async unsaveProperty(userId: string, propertyId: string): Promise<void> {
    const supabase = await this.client();
    const { error } = await supabase
      .from('saved_properties')
      .delete()
      .eq('user_id', userId)
      .eq('property_id', propertyId);

    if (error) throw new Error(`unsaveProperty: ${error.message}`);
  }

  async isPropertySaved(userId: string, propertyId: string): Promise<boolean> {
    const supabase = await this.client();
    const { data } = await supabase
      .from('saved_properties')
      .select('property_id')
      .eq('user_id', userId)
      .eq('property_id', propertyId)
      .maybeSingle();

    return data !== null;
  }

  async setSavedPropertyNote(
    userId: string,
    propertyId: string,
    note: string | null,
  ): Promise<void> {
    const supabase = await this.client();
    const { error } = await supabase
      .from('saved_properties')
      .update({ note })
      .eq('user_id', userId)
      .eq('property_id', propertyId);

    if (error) throw new Error(`setSavedPropertyNote: ${error.message}`);
  }

  /* ---------------------------------------------------------------------
   * Authority requests
   *
   * Every method here records or reads. None of them gathers or transmits the
   * information a request asks for, and there is no code path from this section
   * to an email address, a review, a verification record or a location check.
   * That absence is the design, not an omission.
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
    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_open_authority_request', {
      requesting_authority: input.requestingAuthority,
      jurisdiction: input.jurisdiction,
      request_type: input.requestType,
      requested_information: input.requestedInformation,
      external_reference: input.externalReference,
      legal_basis: input.legalBasis,
      documentation_received: input.documentationReceived,
      subject_user_id: input.subjectUserId,
      related_case_id: input.caseId,
    });

    if (error) throw new Error(`openAuthorityRequest: ${error.message}`);
    return data as string;
  }

  async decideAuthorityRequest(input: {
    requestId: string;
    status: AuthorityRequestStatus;
    decision: string | null;
    documentationReceived: boolean | null;
    actorId: string;
  }): Promise<void> {
    const supabase = await this.client();

    const { error } = await supabase.rpc('livd_decide_authority_request', {
      request_id: input.requestId,
      new_status: input.status,
      decision_text: input.decision,
      docs_received: input.documentationReceived,
    });

    if (error) throw new Error(`decideAuthorityRequest: ${error.message}`);
  }

  async recordDisclosure(input: {
    requestId: string;
    disclosedFields: string[];
    disclosedTo: string;
    method: DisclosureRecord['method'];
    notes: string | null;
    actorId: string;
  }): Promise<string> {
    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_record_disclosure', {
      request_id: input.requestId,
      disclosed_fields: input.disclosedFields,
      disclosed_to: input.disclosedTo,
      method: input.method,
      notes: input.notes,
    });

    if (error) throw new Error(`recordDisclosure: ${error.message}`);
    return data as string;
  }

  async listAuthorityRequests(
    options: { status?: AuthorityRequestStatus | null; openOnly?: boolean; limit?: number } = {},
  ): Promise<AuthorityRequest[]> {
    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_list_authority_requests', {
      filter_status: options.status ?? null,
      only_open: options.openOnly ?? false,
      page_size: Math.min(Math.max(options.limit ?? 50, 1), 200),
    });

    if (error) throw new Error(`listAuthorityRequests: ${error.message}`);

    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      reference: row.reference as string,
      requestingAuthority: row.requesting_authority as string,
      jurisdiction: row.jurisdiction as string,
      requestType: row.request_type as AuthorityRequestType,
      externalReference: (row.external_reference as string | null) ?? null,
      requestedInformation: row.requested_information as string,
      legalBasis: (row.legal_basis as string | null) ?? null,
      documentationReceived: Boolean(row.documentation_received),
      status: row.status as AuthorityRequestStatus,
      receivedAt: row.received_at as string,
      assignedTo: (row.assigned_to as string | null) ?? null,
      decision: (row.decision as string | null) ?? null,
      decidedBy: (row.decided_by as string | null) ?? null,
      decidedAt: (row.decided_at as string | null) ?? null,
      caseId: (row.case_id as string | null) ?? null,
      caseReference: (row.case_reference as string | null) ?? null,
      subjectUserId: (row.subject_user_id as string | null) ?? null,
      disclosureCount: Number(row.disclosure_count ?? 0),
      createdAt: row.created_at as string,
    }));
  }

  async listDisclosures(requestId: string | null = null): Promise<DisclosureRecord[]> {
    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_list_disclosures', {
      target_request_id: requestId,
    });

    if (error) throw new Error(`listDisclosures: ${error.message}`);

    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      requestId: row.request_id as string,
      subjectUserId: (row.subject_user_id as string | null) ?? null,
      disclosedFields: (row.disclosed_fields as string[] | null) ?? [],
      disclosedTo: row.disclosed_to as string,
      method: row.method as DisclosureRecord['method'],
      authorisedBy: (row.authorised_by as string | null) ?? null,
      recordedBy: (row.recorded_by as string | null) ?? null,
      disclosedAt: row.disclosed_at as string,
      notes: (row.notes as string | null) ?? null,
    }));
  }

  /* ---------------------------------------------------------------------
   * Sanctions
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
    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_apply_sanction', {
      target_user_id: input.userId,
      sanction_action: input.action,
      reason_key: input.reasonKey,
      sanction_reason: input.reason,
      duration_days: input.durationDays,
      related_case_id: input.caseId,
    });

    if (error) throw new Error(`applySanction: ${error.message}`);
    return data as string;
  }

  async liftSanction(sanctionId: string, reason: string): Promise<void> {
    const supabase = await this.client();

    const { error } = await supabase.rpc('livd_lift_sanction', {
      sanction_id: sanctionId,
      why: reason,
    });

    if (error) throw new Error(`liftSanction: ${error.message}`);
  }

  async listSanctions(
    options: { userId?: string | null; activeOnly?: boolean; limit?: number } = {},
  ): Promise<Sanction[]> {
    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_list_sanctions', {
      target_user_id: options.userId ?? null,
      only_active: options.activeOnly ?? false,
      page_size: Math.min(Math.max(options.limit ?? 50, 1), 200),
    });

    if (error) throw new Error(`listSanctions: ${error.message}`);

    return ((data ?? []) as Array<{
      id: string;
      user_id: string;
      action: SanctionAction;
      reason_key: string;
      reason: string;
      case_id: string | null;
      case_reference: string | null;
      applied_by: string | null;
      starts_at: string;
      ends_at: string | null;
      lifted_at: string | null;
      lifted_by: string | null;
      lifted_reason: string | null;
      is_active: boolean;
      created_at: string;
    }>).map((row) => ({
      id: row.id,
      userId: row.user_id,
      action: row.action,
      reasonKey: row.reason_key,
      reason: row.reason,
      caseId: row.case_id,
      caseReference: row.case_reference,
      appliedBy: row.applied_by,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      liftedAt: row.lifted_at,
      liftedBy: row.lifted_by,
      liftedReason: row.lifted_reason,
      isActive: row.is_active,
      createdAt: row.created_at,
    }));
  }

  async listSanctionReasons(): Promise<SanctionReason[]> {
    const supabase = await this.client();

    const { data, error } = await supabase
      .from('sanction_reason_defs')
      .select('key, label, description, suggested_action')
      .eq('is_active', true)
      .order('sort_order');

    if (error) throw new Error(`listSanctionReasons: ${error.message}`);

    return ((data ?? []) as Array<{
      key: string;
      label: string;
      description: string;
      suggested_action: SanctionAction;
    }>).map((row) => ({
      key: row.key,
      label: row.label,
      description: row.description,
      suggestedAction: row.suggested_action,
    }));
  }

  /* ---------------------------------------------------------------------
   * Evidence
   * ------------------------------------------------------------------ */

  async listReviewSnapshots(reviewId: string): Promise<ReviewSnapshot[]> {
    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_review_snapshots', {
      target_review_id: reviewId,
    });

    if (error) throw new Error(`listReviewSnapshots: ${error.message}`);

    return ((data ?? []) as Array<{
      id: string;
      reason: ReviewSnapshot['reason'];
      body: string | null;
      overall_rating: number | null;
      would_recommend: boolean | null;
      verification_level: ReviewSnapshot['verificationLevel'];
      status: ReviewSnapshot['status'];
      safety_flags: string[] | null;
      category_ratings: unknown;
      positive_tags: string[] | null;
      problem_tags: string[] | null;
      changed_by: string | null;
      created_at: string;
    }>).map((row) => ({
      id: row.id,
      reason: row.reason,
      body: row.body,
      overallRating: row.overall_rating,
      wouldRecommend: row.would_recommend,
      verificationLevel: row.verification_level,
      status: row.status,
      safetyFlags: row.safety_flags ?? [],
      categoryRatings: (row.category_ratings ?? []) as CategoryRating[],
      positiveTags: row.positive_tags ?? [],
      problemTags: row.problem_tags ?? [],
      changedBy: row.changed_by,
      createdAt: row.created_at,
    }));
  }

  async listCaseEvidence(caseId: string): Promise<CaseEvidenceItem[]> {
    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_list_case_evidence', {
      target_case_id: caseId,
    });

    if (error) throw new Error(`listCaseEvidence: ${error.message}`);

    return ((data ?? []) as Array<{
      id: string;
      kind: CaseEvidenceItem['kind'];
      title: string;
      description: string | null;
      mime: string | null;
      bytes: number | string | null;
      has_file: boolean;
      snapshot_id: string | null;
      version: number;
      supersedes: string | null;
      superseded: boolean;
      added_by: string | null;
      withdrawn_at: string | null;
      withdrawn_by: string | null;
      withdrawn_reason: string | null;
      created_at: string;
    }>).map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      description: row.description,
      mime: row.mime,
      bytes: row.bytes === null ? null : Number(row.bytes),
      // Whether a file exists, never the key that would reach it. The function
      // does not return one, so there is nothing here to accidentally pass on.
      hasFile: row.has_file,
      snapshotId: row.snapshot_id,
      version: row.version,
      supersedes: row.supersedes,
      superseded: row.superseded,
      addedBy: row.added_by,
      withdrawnAt: row.withdrawn_at,
      withdrawnBy: row.withdrawn_by,
      withdrawnReason: row.withdrawn_reason,
      createdAt: row.created_at,
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
    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_add_case_evidence', {
      target_case_id: input.caseId,
      evidence_kind: input.kind,
      evidence_title: input.title,
      evidence_description: input.description,
      supersedes_id: input.supersedes,
    });

    if (error) throw new Error(`addCaseEvidence: ${error.message}`);
    return data as string;
  }

  async withdrawCaseEvidence(evidenceId: string, reason: string): Promise<void> {
    const supabase = await this.client();

    const { error } = await supabase.rpc('livd_withdraw_case_evidence', {
      evidence_id: evidenceId,
      why: reason,
    });

    if (error) throw new Error(`withdrawCaseEvidence: ${error.message}`);
  }

  /* ---------------------------------------------------------------------
   * Review investigation
   * ------------------------------------------------------------------ */

  async getReviewInvestigation(reviewId: string): Promise<ReviewInvestigation | null> {
    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_admin_review_investigation', {
      target_review_id: reviewId,
    });

    if (error) throw new Error(`getReviewInvestigation: ${error.message}`);

    const row = (Array.isArray(data) ? data[0] : data) as ReviewInvestigationRow | undefined;
    if (!row) return null;

    return {
      reviewId: row.review_id,
      body: row.body,
      overallRating: row.overall_rating,
      wouldRecommend: row.would_recommend,
      residencyStatus: row.residency_status,
      movedInMonth: row.moved_in_month,
      movedOutMonth: row.moved_out_month,
      tenureMonths: row.tenure_months,
      verificationLevel: row.verification_level,
      verifiedAt: row.verified_at,
      status: row.status,
      safetyFlags: row.safety_flags ?? [],
      helpfulCount: row.helpful_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,

      // Null for a review whose author deleted their account. The review stays
      // on the property page, permanently unattributable, and this view still
      // has to work.
      author: row.author_id
        ? {
            id: row.author_id,
            status: row.author_status,
            createdAt: row.author_created_at,
            reviewCount: Number(row.author_review_count ?? 0),
            removedReviewCount: Number(row.author_removed_count ?? 0),
            reportsAgainst: Number(row.author_reports_against ?? 0),
            verifiedReviewCount: Number(row.author_verified_count ?? 0),
          }
        : null,

      property: {
        id: row.property_id,
        slug: row.property_slug,
        address: {
          buildingName: row.building_name,
          streetAddress: row.street_address,
          neighbourhood: row.neighbourhood,
          locality: row.locality,
          adminArea: row.admin_area,
          postalCode: row.postal_code,
          countryCode: row.country_code,
        },
        reviewCount: Number(row.property_review_count ?? 0),
        reportedReviewCount: Number(row.property_reported_count ?? 0),
        verifiedReviewCount: Number(row.property_verified_count ?? 0),
        recentReviewCount: Number(row.property_recent_count ?? 0),
        isClaimed: row.property_is_claimed,
      },

      reportCount: Number(row.report_count ?? 0),
      openReportCount: Number(row.open_report_count ?? 0),
      caseCount: Number(row.case_count ?? 0),
    };
  }

  async listReviewVerification(reviewId: string): Promise<ReviewVerificationEntry[]> {
    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_admin_review_verification', {
      target_review_id: reviewId,
    });

    if (error) throw new Error(`listReviewVerification: ${error.message}`);

    return ((data ?? []) as Array<{
      kind: 'location' | 'residency';
      id: string;
      method: string;
      outcome: string;
      failure_reason: string | null;
      at_this_property: boolean;
      created_at: string;
      decided_at: string | null;
      has_evidence: boolean;
    }>).map((row) => ({
      kind: row.kind,
      id: row.id,
      method: row.method,
      outcome: row.outcome,
      failureReason: row.failure_reason,
      atThisProperty: row.at_this_property,
      createdAt: row.created_at,
      decidedAt: row.decided_at,
      hasEvidence: row.has_evidence,
    }));
  }

  async listReviewReports(reviewId: string): Promise<ReviewReportEntry[]> {
    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_admin_review_reports', {
      target_review_id: reviewId,
    });

    if (error) throw new Error(`listReviewReports: ${error.message}`);

    return ((data ?? []) as Array<{
      report_id: string;
      reporter_id: string | null;
      reason: ReviewReportEntry['reason'];
      detail: string | null;
      status: ReviewReportEntry['status'];
      resolution: string | null;
      case_id: string | null;
      case_reference: string | null;
      created_at: string;
      resolved_at: string | null;
    }>).map((row) => ({
      reportId: row.report_id,
      reporterId: row.reporter_id,
      reason: row.reason,
      detail: row.detail,
      status: row.status,
      resolution: row.resolution,
      caseId: row.case_id,
      caseReference: row.case_reference,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    }));
  }

  /* ---------------------------------------------------------------------
   * Trust & Safety cases
   *
   * Every write here is one RPC, and each of those functions emits its timeline
   * event in the same transaction as the change it makes. There is deliberately
   * no path from this adapter to `ts_cases` directly — a status that moved
   * without an event is not a state the database can reach, and it stays that
   * way because nothing here can write the table.
   * ------------------------------------------------------------------ */

  async openCase(input: {
    category: string;
    summary: string;
    fromReportId?: string | null;
    reviewId?: string | null;
    priority?: CasePriority | null;
    actorId: string;
  }): Promise<string> {
    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_open_case', {
      case_category: input.category,
      case_summary: input.summary,
      from_report_id: input.fromReportId ?? null,
      review_id: input.reviewId ?? null,
      case_priority_override: input.priority ?? null,
    });

    if (error) throw new Error(`openCase: ${error.message}`);
    return data as string;
  }

  async listCases(filters: CaseFilters = {}): Promise<CasePage> {
    const pageSize = Math.min(Math.max(filters.pageSize ?? ADMIN_PAGE_SIZE, 1), 100);
    const page = Math.max(filters.page ?? 1, 1);

    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_list_cases', {
      page_size: pageSize,
      page_offset: (page - 1) * pageSize,
      filter_status: filters.status ?? null,
      filter_priority: filters.priority ?? null,
      filter_category: filters.category ?? null,
      filter_assignee: filters.assignedTo ?? null,
      only_unassigned: filters.unassignedOnly ?? false,
      only_open: filters.openOnly ?? false,
      search_reference: filters.reference ?? null,
    });

    if (error) throw new Error(`listCases: ${error.message}`);

    const rows = (data ?? []) as CaseRow[];

    return {
      items: rows.map(toCaseSummary),
      total: rows[0]?.total_count ? Number(rows[0].total_count) : 0,
      page,
      pageSize,
    };
  }

  async getCase(caseId: string): Promise<CaseSummary | null> {
    const supabase = await this.client();

    // Filtered by reference through the same listing function rather than a
    // second query against the table, so a case reads identically whichever
    // screen asked for it — and so there stays exactly one place where a case
    // row is shaped.
    const { data, error } = await supabase.rpc('livd_list_cases', {
      page_size: 1,
      page_offset: 0,
      filter_case_id: caseId,
    });

    if (error) throw new Error(`getCase: ${error.message}`);

    const row = ((data ?? []) as CaseRow[])[0];
    return row ? toCaseSummary(row) : null;
  }

  async listCaseEvents(caseId: string, limit = 200): Promise<CaseEvent[]> {
    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_case_timeline', {
      target_case_id: caseId,
      page_size: limit,
    });

    if (error) throw new Error(`listCaseEvents: ${error.message}`);

    return ((data ?? []) as Array<{
      id: number | string;
      actor_id: string | null;
      kind: string;
      summary: string;
      detail: unknown;
      created_at: string;
    }>).map((row) => ({
      id: String(row.id),
      actorId: row.actor_id,
      kind: row.kind,
      summary: row.summary,
      detail: (row.detail ?? {}) as Record<string, unknown>,
      createdAt: row.created_at,
    }));
  }

  async listCaseNotes(caseId: string, limit = 100): Promise<CaseNote[]> {
    const supabase = await this.client();

    const { data, error } = await supabase
      .from('case_notes')
      .select('id, author_id, body, created_at')
      .eq('case_id', caseId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`listCaseNotes: ${error.message}`);

    return ((data ?? []) as Array<{
      id: string;
      author_id: string | null;
      body: string;
      created_at: string;
    }>).map((row) => ({
      id: row.id,
      authorId: row.author_id,
      body: row.body,
      createdAt: row.created_at,
    }));
  }

  async listCaseReports(caseId: string): Promise<ReviewReport[]> {
    const supabase = await this.client();

    const { data, error } = await supabase
      .from('review_reports')
      .select(
        'id, review_id, reporter_id, reason, detail, status, resolution, case_id, created_at, resolved_at',
      )
      .eq('case_id', caseId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`listCaseReports: ${error.message}`);

    return ((data ?? []) as unknown as ReportRow[]).map(toReport);
  }

  async listCaseCategories(): Promise<CaseCategory[]> {
    const supabase = await this.client();

    const { data, error } = await supabase
      .from('case_category_defs')
      .select('key, label, description, default_priority')
      .eq('is_active', true)
      .order('sort_order');

    if (error) throw new Error(`listCaseCategories: ${error.message}`);

    return ((data ?? []) as Array<{
      key: string;
      label: string;
      description: string;
      default_priority: CasePriority;
    }>).map((row) => ({
      key: row.key,
      label: row.label,
      description: row.description,
      defaultPriority: row.default_priority,
    }));
  }

  async assignCase(caseId: string, assigneeId: string | null): Promise<void> {
    const supabase = await this.client();
    const { error } = await supabase.rpc('livd_assign_case', {
      target_case_id: caseId,
      assignee: assigneeId,
    });
    if (error) throw new Error(`assignCase: ${error.message}`);
  }

  async setCaseStatus(caseId: string, status: CaseStatus, outcome: string | null): Promise<void> {
    const supabase = await this.client();
    const { error } = await supabase.rpc('livd_set_case_status', {
      target_case_id: caseId,
      new_status: status,
      case_outcome: outcome,
    });
    if (error) throw new Error(`setCaseStatus: ${error.message}`);
  }

  async setCasePriority(
    caseId: string,
    priority: CasePriority,
    why: string | null,
  ): Promise<void> {
    const supabase = await this.client();
    const { error } = await supabase.rpc('livd_set_case_priority', {
      target_case_id: caseId,
      new_priority: priority,
      why,
    });
    if (error) throw new Error(`setCasePriority: ${error.message}`);
  }

  async addCaseNote(caseId: string, body: string): Promise<void> {
    const supabase = await this.client();
    const { error } = await supabase.rpc('livd_add_case_note', {
      target_case_id: caseId,
      note_body: body,
    });
    if (error) throw new Error(`addCaseNote: ${error.message}`);
  }

  async setCasePreservation(caseId: string, hold: boolean, why: string): Promise<void> {
    const supabase = await this.client();
    const { error } = await supabase.rpc('livd_set_case_preservation', {
      target_case_id: caseId,
      hold,
      why,
    });
    if (error) throw new Error(`setCasePreservation: ${error.message}`);
  }

  /* ---------------------------------------------------------------------
   * Identity
   * ------------------------------------------------------------------ */

  /**
   * Reveals an account's email address.
   *
   * Through the caller's own session, because the function reads `auth.uid()`
   * to decide whether they may and to stamp the record — the service role has
   * no identity and could not be held to either.
   *
   * `livd_reveal_user_identity` inserts the audit entry and returns the address
   * in one transaction. If the insert fails the transaction aborts and nothing
   * comes back, so there is no path by which this method returns an address
   * that was not recorded.
   */
  async revealUserIdentity(input: {
    userId: string;
    reasonKey: string;
    reasonDetail: string | null;
    caseReference: string | null;
    actorIpHash: string | null;
    actorId: string;
  }): Promise<IdentityReveal> {
    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_reveal_user_identity', {
      target_user_id: input.userId,
      reason_key: input.reasonKey,
      reason_detail: input.reasonDetail,
      case_reference: input.caseReference,
      actor_ip_hash: input.actorIpHash,
    });

    if (error) throw new Error(`revealUserIdentity: ${error.message}`);

    const row = (Array.isArray(data) ? data[0] : data) as
      | {
          email: string;
          account_id: string;
          role: UserProfile['role'];
          status: UserProfile['status'];
          country_code: string | null;
          created_at: string;
          audit_entry_id: number | string;
        }
      | undefined;

    if (!row) throw new Error('revealUserIdentity: no such account');

    return {
      email: row.email,
      accountId: row.account_id,
      role: row.role,
      status: row.status,
      countryCode: row.country_code,
      createdAt: row.created_at,
      auditEntryId: String(row.audit_entry_id),
    };
  }

  async listIdentityAccessReasons(): Promise<IdentityAccessReason[]> {
    const supabase = await this.client();

    const { data, error } = await supabase
      .from('identity_access_reasons')
      .select('key, label, description, requires_detail')
      .eq('is_active', true)
      .order('sort_order');

    if (error) throw new Error(`listIdentityAccessReasons: ${error.message}`);

    return ((data ?? []) as Array<{
      key: string;
      label: string;
      description: string;
      requires_detail: boolean;
    }>).map((row) => ({
      key: row.key,
      label: row.label,
      description: row.description,
      requiresDetail: row.requires_detail,
    }));
  }

  async listIdentityAccess(userId: string, limit = 20): Promise<IdentityAccessRecord[]> {
    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_identity_access_history', {
      target_user_id: userId,
      page_size: limit,
    });

    if (error) throw new Error(`listIdentityAccess: ${error.message}`);

    return ((data ?? []) as Array<{
      id: number | string;
      actor_id: string | null;
      actor_role: UserProfile['role'];
      outcome: IdentityAccessRecord['outcome'];
      reason: string | null;
      detail: { caseReference?: string } | null;
      created_at: string;
    }>).map((row) => ({
      id: String(row.id),
      actorId: row.actor_id,
      actorRole: row.actor_role,
      outcome: row.outcome,
      reason: row.reason,
      caseReference: row.detail?.caseReference ?? null,
      createdAt: row.created_at,
    }));
  }

  /* ---------------------------------------------------------------------
   * Administrative audit
   * ------------------------------------------------------------------ */

  /**
   * Records one sensitive administrative access.
   *
   * Through the caller's own session, so `livd_record_admin_audit` can stamp
   * the actor and their role from `auth.uid()`. Neither is accepted as an
   * argument — an entry that could name its own author would be an entry
   * anybody could forge, which is not an audit trail.
   */
  async recordAdminAudit(entry: AdminAuditEntry): Promise<void> {
    const supabase = await this.client();

    const { error } = await supabase.rpc('livd_record_admin_audit', {
      audit_action: entry.action,
      subject_type: entry.subjectType,
      subject_id: entry.subjectId,
      outcome: entry.outcome,
      reason: entry.reason,
      detail: entry.detail,
      actor_ip_hash: entry.actorIpHash,
    });

    if (error) throw new Error(`recordAdminAudit: ${error.message}`);
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

    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_admin_audit_log', {
      page_size: pageSize,
      page_offset: (page - 1) * pageSize,
      filter_action: options.action ?? null,
      filter_subject: options.subjectId ?? null,
    });

    if (error) throw new Error(`listAdminAudit: ${error.message}`);

    const rows = (data ?? []) as AdminAuditRow[];

    return {
      items: rows.map((row) => ({
        id: String(row.id),
        actorId: row.actor_id,
        actorRole: row.actor_role,
        action: row.action,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        outcome: row.outcome,
        reason: row.reason,
        detail: (row.detail ?? {}) as Record<string, unknown>,
        createdAt: row.created_at,
      })),
      total: rows[0]?.total_count ? Number(rows[0].total_count) : 0,
      page,
      pageSize,
    };
  }

  /**
   * Both trails, unified for reading.
   *
   * Through the caller's own session, and for two reasons rather than one.
   * `livd_admin_audit_feed` checks `livd_is_trust_admin()` against
   * `auth.uid()`, so the boundary holds; and it writes its own
   * `audit_log_read` entry from that same session, so the record of the read
   * names the person who did it. The service role could do neither.
   */
  async listAuditFeed(filters: AuditFeedFilters = {}): Promise<AuditFeedPage> {
    const pageSize = Math.min(Math.max(filters.pageSize ?? 50, 1), 200);
    const page = Math.max(filters.page ?? 1, 1);

    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_admin_audit_feed', {
      page_size: pageSize,
      page_offset: (page - 1) * pageSize,
      filter_source: filters.source ?? null,
      filter_action: filters.action ?? null,
      filter_actor: filters.actorId ?? null,
      filter_outcome: filters.outcome ?? null,
      filter_subject_type: filters.subjectType ?? null,
      filter_subject: filters.subjectId ?? null,
      since: filters.since ?? null,
      until: filters.until ?? null,
      include_reads: filters.includeReads ?? false,
    });

    if (error) throw new Error(`listAuditFeed: ${error.message}`);

    const rows = (data ?? []) as AuditFeedRow[];

    return {
      items: rows.map((row) => ({
        id: row.entry_id,
        source: row.source,
        actorId: row.actor_id,
        actorRole: row.actor_role,
        actorEmailMasked: row.actor_email_masked,
        action: row.action,
        rawAction: row.raw_action,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        outcome: row.outcome,
        reason: row.reason,
        detail: (row.detail ?? {}) as Record<string, unknown>,
        createdAt: row.created_at,
      })),
      total: rows[0]?.total_count ? Number(rows[0].total_count) : 0,
      page,
      pageSize,
    };
  }

  async auditActionSummary(since: string | null = null): Promise<AuditActionSummary[]> {
    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_admin_audit_summary', { since });
    if (error) throw new Error(`auditActionSummary: ${error.message}`);

    return ((data ?? []) as AuditSummaryRow[]).map((row) => ({
      action: row.action,
      entries: Number(row.entries),
      actors: Number(row.actors),
      denials: Number(row.denials),
      lastAt: row.last_at,
    }));
  }

  async auditActors(since: string | null = null): Promise<AuditActorSummary[]> {
    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_admin_audit_actors', { since });
    if (error) throw new Error(`auditActors: ${error.message}`);

    return ((data ?? []) as AuditActorRow[]).map((row) => ({
      actorId: row.actor_id,
      actorRole: row.actor_role,
      actorEmailMasked: row.actor_email_masked,
      entries: Number(row.entries),
      denials: Number(row.denials),
      lastAt: row.last_at,
    }));
  }

  /* ---------------------------------------------------------------------
   * Users
   * ------------------------------------------------------------------ */

  async getUserById(id: string): Promise<UserProfile | null> {
    const supabase = await this.client();
    const { data, error } = await supabase
      .from('profiles')
      .select('id, role, status, country_code, preferred_locale, created_at')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(`getUserById: ${error.message}`);
    if (!data) return null;

    // The email lives in auth.users and is never selected into a public shape.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    return toUserProfile(data as unknown as ProfileRow, user?.id === id ? (user.email ?? '') : '');
  }

  /**
   * One account, masked.
   *
   * Note what this cannot return. `livd_admin_user_detail` selects
   * `livd_mask_email(u.email)` and never `u.email`, so there is no code path
   * from this method to an address — not a guarded one, none at all. The reveal
   * is a different function with a different authorisation and an audit entry
   * of its own.
   */
  async getAdminUserDetail(userId: string): Promise<AdminUserDetail | null> {
    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_admin_user_detail', {
      target_user_id: userId,
    });

    if (error) throw new Error(`getAdminUserDetail: ${error.message}`);

    const row = (Array.isArray(data) ? data[0] : data) as AdminUserDetailRow | undefined;
    if (!row) return null;

    return {
      id: row.id,
      maskedEmail: row.masked_email,
      role: row.role,
      status: row.status,
      countryCode: row.country_code,
      preferredLocale: row.preferred_locale,
      createdAt: row.created_at,
      reviewCount: Number(row.review_count ?? 0),
      publishedReviewCount: Number(row.published_review_count ?? 0),
      removedReviewCount: Number(row.removed_review_count ?? 0),
      heldReviewCount: Number(row.held_review_count ?? 0),
      verifiedReviewCount: Number(row.verified_review_count ?? 0),
      reportsAgainst: Number(row.reports_against ?? 0),
      reportsMade: Number(row.reports_made ?? 0),
      locationCheckCount: Number(row.location_check_count ?? 0),
      residencySubmissions: Number(row.residency_submissions ?? 0),
      lastReviewAt: row.last_review_at,
    };
  }

  async listAdminUserReviews(
    userId: string,
    options: { page?: number; pageSize?: number } = {},
  ): Promise<{ items: AdminUserReview[]; total: number; page: number; pageSize: number }> {
    const pageSize = Math.min(Math.max(options.pageSize ?? ADMIN_PAGE_SIZE, 1), 100);
    const page = Math.max(options.page ?? 1, 1);

    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_admin_user_reviews', {
      target_user_id: userId,
      page_size: pageSize,
      page_offset: (page - 1) * pageSize,
    });

    if (error) throw new Error(`listAdminUserReviews: ${error.message}`);

    const rows = (data ?? []) as AdminUserReviewRow[];

    return {
      items: rows.map((row) => ({
        reviewId: row.review_id,
        propertyId: row.property_id,
        propertySlug: row.property_slug,
        // Components, not a rendered string: the admin console formats an
        // address with the same per-country template as every other surface.
        address: {
          buildingName: row.building_name,
          streetAddress: row.street_address,
          neighbourhood: row.neighbourhood,
          locality: row.locality,
          adminArea: row.admin_area,
          postalCode: row.postal_code,
          countryCode: row.country_code,
        },
        overallRating: row.overall_rating,
        residencyStatus: row.residency_status,
        verificationLevel: row.verification_level,
        status: row.status,
        createdAt: row.created_at,
        reportCount: Number(row.report_count ?? 0),
      })),
      total: rows[0]?.total_count ? Number(rows[0].total_count) : 0,
      page,
      pageSize,
    };
  }

  async listAdminUserReports(
    userId: string,
    options: { page?: number; pageSize?: number } = {},
  ): Promise<{ items: AdminUserReport[]; total: number; page: number; pageSize: number }> {
    const pageSize = Math.min(Math.max(options.pageSize ?? ADMIN_PAGE_SIZE, 1), 100);
    const page = Math.max(options.page ?? 1, 1);

    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_admin_user_reports', {
      target_user_id: userId,
      page_size: pageSize,
      page_offset: (page - 1) * pageSize,
    });

    if (error) throw new Error(`listAdminUserReports: ${error.message}`);

    const rows = (data ?? []) as AdminUserReportRow[];

    return {
      items: rows.map((row) => ({
        reportId: row.report_id,
        reviewId: row.review_id,
        reporterId: row.reporter_id,
        reason: row.reason,
        detail: row.detail,
        status: row.status,
        resolution: row.resolution,
        caseId: row.case_id ?? null,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
      })),
      total: rows[0]?.total_count ? Number(rows[0].total_count) : 0,
      page,
      pageSize,
    };
  }

  /**
   * Resolves an address to an account id.
   *
   * One indexed lookup inside `livd_admin_find_user_by_email`, behind that
   * function's own moderator check. It replaces a loop over
   * `auth.admin.listUsers()` with no pagination, which searched only the first
   * page — fifty accounts, against a deployment that has a hundred and
   * twenty-four — and returned "no such account" for everybody else.
   *
   * Through the caller's session, not the service role, so the authorisation
   * is evaluated against the real JWT rather than asserted by this process.
   */
  async findUserIdByEmail(email: string): Promise<string | null> {
    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_admin_find_user_by_email', {
      lookup_email: email,
    });

    if (error) throw new Error(`findUserIdByEmail: ${error.message}`);
    return (data as string | null) ?? null;
  }

  async upsertUser(input: {
    id?: string;
    email: string;
    countryCode?: string | null;
  }): Promise<UserProfile> {
    // Accounts are created by Supabase Auth, never here. This only ensures the
    // profile row exists and applies a country preference.
    if (!input.id) throw new Error('upsertUser requires an auth user id under Supabase');

    const admin = this.admin();
    const data = unwrap(
      await admin
        .from('profiles')
        .upsert(
          {
            id: input.id,
            ...(input.countryCode !== undefined ? { country_code: input.countryCode } : {}),
          },
          { onConflict: 'id' },
        )
        .select('id, role, status, country_code, preferred_locale, created_at')
        .single(),
      'upsertUser',
    );

    return toUserProfile(data as unknown as ProfileRow, input.email);
  }

  /**
   * One page of the administrative user directory.
   *
   * The whole query lives in `livd_admin_user_directory`, which joins
   * `profiles` to `auth.users` and applies `livd_mask_email` before returning
   * a row. Nothing in this process ever holds a real address, so nothing here
   * can leak one.
   *
   * What this replaced is worth remembering. It selected profiles ordered by
   * creation, fetched the first page of Auth users in Auth's own order, zipped
   * the two together by id and handed the result to a page that printed
   * `user.email`. Every moderator read every account's address, unlogged — and
   * past the first page the addresses did not even belong to the rows they
   * were shown beside.
   */
  async listAdminUsers(filters: AdminUserFilters = {}): Promise<AdminUserPage> {
    const pageSize = Math.min(Math.max(filters.pageSize ?? ADMIN_PAGE_SIZE, 1), 100);
    const page = Math.max(filters.page ?? 1, 1);

    const supabase = await this.client();

    const { data, error } = await supabase.rpc('livd_admin_user_directory', {
      page_size: pageSize,
      page_offset: (page - 1) * pageSize,
      search_term: filters.search ?? null,
      filter_role: filters.role ?? null,
      filter_status: filters.status ?? null,
      filter_verified: filters.hasVerifiedReviews ?? null,
      filter_reported: filters.hasReports ?? null,
      joined_after: filters.joinedAfter ?? null,
      min_review_count: filters.minReviews ?? null,
    });

    if (error) throw new Error(`listAdminUsers: ${error.message}`);

    const rows = (data ?? []) as AdminUserDirectoryRow[];

    return {
      items: rows.map((row) => ({
        id: row.id,
        maskedEmail: row.masked_email,
        role: row.role,
        status: row.status,
        countryCode: row.country_code,
        createdAt: row.created_at,
        reviewCount: Number(row.review_count ?? 0),
        verifiedReviewCount: Number(row.verified_review_count ?? 0),
        reportsAgainst: Number(row.reports_against ?? 0),
        lastReviewAt: row.last_review_at,
      })),
      // `count(*) over ()` rides on every row, so a page with rows knows the
      // total without a second query. An empty page past the end knows only
      // that it is empty, which is all the pager needs.
      total: rows[0]?.total_count ? Number(rows[0].total_count) : 0,
      page,
      pageSize,
    };
  }

  /**
   * Grants a role.
   *
   * Through the caller's own session, never the service role, and never as a
   * direct write to the column. Until 0020 this method did exactly that —
   * `admin.from('profiles').update({ role })` — which meant the only thing
   * standing between a moderator and an administrator was a
   * `requireRole('admin')` call in a Server Action. PostgREST does not run
   * Server Actions, and the policy protecting the column exempted moderators,
   * so the check was decorative.
   *
   * Now the database owns the decision. `livd_set_user_role` reads the actor
   * from `auth.uid()`, refuses anyone who is not an administrator, refuses a
   * self-change, refuses to demote the last administrator, demands a reason
   * and writes the audit row in the same transaction as the update. The
   * service-role client could not do this even if it wanted to: a trigger
   * refuses any write to `role` that did not come through this function.
   *
   * `actorId` is unused here on purpose — see the note on the interface.
   */
  async setUserRole(
    userId: string,
    role: UserProfile['role'],
    _actorId: string,
    reason: string,
  ): Promise<void> {
    const supabase = await this.client();

    const { error } = await supabase.rpc('livd_set_user_role', {
      target_user_id: userId,
      new_role: role,
      change_reason: reason,
    });

    if (error) throw new Error(`setUserRole: ${error.message}`);
  }

  /** As `setUserRole`, for standing rather than privilege. */
  async setUserStatus(
    userId: string,
    status: UserProfile['status'],
    _actorId: string,
    reason: string,
  ): Promise<void> {
    const supabase = await this.client();

    const { error } = await supabase.rpc('livd_set_user_status', {
      target_user_id: userId,
      new_status: status,
      change_reason: reason,
    });

    if (error) throw new Error(`setUserStatus: ${error.message}`);
  }

  /**
   * Erases an account.
   *
   * Migration 0017 does most of this: every foreign key to `profiles` now
   * either severs (reviews, owner responses, the moderation record) or
   * cascades (the shortlist, notifications, votes, claims, location checks,
   * verification rows). Deleting the auth user triggers all of it in one
   * transaction the database guarantees.
   *
   * What the database cannot do is delete a *file*. `verification_records`
   * cascades away, but the tenancy agreement it pointed at stays in the
   * private bucket for ever — a document carrying a name, an address and a
   * signature, orphaned by the very operation meant to erase the person. So
   * the objects go first, deliberately, before anything is irreversible.
   *
   * Ordering that the other way would be the single worst bug this feature
   * could have: the row that names the file would already be gone, leaving
   * nothing to find it by.
   */
  async deleteAccount(userId: string): Promise<AccountDeletionSummary> {
    // Service role throughout: this reads across a person's whole footprint and
    // then removes their auth record, neither of which any client role can do.
    const admin = this.admin();

    /* --- Count what will survive, before it is severed ---------------- */

    const [{ count: reviewCount }, { count: responseCount }, { count: savedCount }, { count: checkCount }] =
      await Promise.all([
        admin.from('reviews').select('id', { count: 'exact', head: true }).eq('author_id', userId),
        admin
          .from('owner_responses')
          .select('id', { count: 'exact', head: true })
          .eq('responder_id', userId),
        admin
          .from('saved_properties')
          .select('property_id', { count: 'exact', head: true })
          .eq('user_id', userId),
        admin
          .from('property_verifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId),
      ]);

    /* --- Destroy the evidence files first ----------------------------- */

    const { data: evidence } = await admin
      .from('verification_records')
      .select('evidence_ref')
      .eq('submitted_by', userId);

    const refs = ((evidence ?? []) as Array<{ evidence_ref: string | null }>)
      .map((row) => row.evidence_ref)
      .filter((ref): ref is string => Boolean(ref));

    let evidenceFilesDestroyed = 0;
    if (refs.length > 0) {
      const { data: removed, error } = await admin.storage.from(EVIDENCE_BUCKET).remove(refs);

      if (error) {
        // Refuse to continue. Deleting the account now would orphan a tenancy
        // agreement in storage with nothing left pointing at it — the one
        // outcome this whole method exists to prevent. Better to fail loudly
        // and let the person try again.
        throw new Error(
          `deleteAccount: could not remove residency evidence, so the account was left intact: ${error.message}`,
        );
      }

      evidenceFilesDestroyed = removed?.length ?? refs.length;
    }

    /* --- Then the account itself -------------------------------------- */

    // Deleting the auth user cascades to `profiles`, and from there through
    // every foreign key set up in 0017.
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      throw new Error(`deleteAccount: ${deleteError.message}`);
    }

    return {
      reviewsUnlinked: reviewCount ?? 0,
      responsesUnlinked: responseCount ?? 0,
      evidenceFilesDestroyed,
      locationChecksDestroyed: checkCount ?? 0,
      savedPropertiesDestroyed: savedCount ?? 0,
    };
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
    const supabase = this.publicClient();

    // Analytics must never break a user-facing request.
    await supabase
      .from('search_events')
      .insert({
        query_hash: input.queryHash,
        country_code: input.countryCode,
        locality: input.locality,
        result_count: input.resultCount,
      })
      .then(
        () => undefined,
        () => undefined,
      );
  }

  async adminOverview(): Promise<AdminOverview> {
    const admin = this.admin();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

    const count = async (
      table: string,
      refine?: (query: ReturnType<SupabaseClient['from']>) => unknown,
    ): Promise<number> => {
      let query = admin.from(table).select('*', { count: 'exact', head: true });
      if (refine) query = refine(query as never) as typeof query;
      const { count: result } = await query;
      return result ?? 0;
    };

    const [
      propertyCount,
      reviewCount,
      pendingModerationCount,
      openReportCount,
      openFlagCount,
      pendingVerificationCount,
      pendingClaimCount,
      userCount,
      reviewsLast30Days,
    ] = await Promise.all([
      count('properties', (q) => (q as never as { eq: Function }).eq('status', 'active')),
      count('reviews', (q) => (q as never as { eq: Function }).eq('status', 'published')),
      count('reviews', (q) => (q as never as { eq: Function }).eq('status', 'pending_moderation')),
      count('review_reports', (q) => (q as never as { eq: Function }).eq('status', 'open')),
      count('property_flags', (q) => (q as never as { eq: Function }).eq('status', 'open')),
      count('verification_records', (q) => (q as never as { eq: Function }).eq('outcome', 'pending')),
      count('property_claims', (q) => (q as never as { eq: Function }).eq('status', 'pending')),
      count('profiles'),
      count('reviews', (q) => (q as never as { gte: Function }).gte('created_at', thirtyDaysAgo)),
    ]);

    return {
      propertyCount,
      reviewCount,
      pendingModerationCount,
      openReportCount,
      openFlagCount,
      pendingVerificationCount,
      pendingClaimCount,
      userCount,
      reviewsLast30Days,
    };
  }
}

/** Whole months between two month-pinned dates; both ends count. */
function monthsBetween(movedInMonth: string, movedOutMonth: string | null): number {
  const start = new Date(movedInMonth);
  const end = movedOutMonth ? new Date(movedOutMonth) : new Date();
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth());
  return Math.max(1, months);
}

/** Kept so the module's search helpers stay colocated with their only consumer. */
export { normaliseForSearch };
