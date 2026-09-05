import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { TAG_DEFINITIONS } from '@/config/tags';
import { LIMITS, showDemoData } from '@/config/site';
import { buildPropertyIntelligence, emptyIntelligence } from '@/lib/intelligence';
import { normaliseForSearch } from '@/lib/search/matching';
import { propertyContextLine, propertyDisplayName } from '@/lib/format';
import { propertySlug } from '@/lib/utils';
import {
  createServerSupabaseClient,
  createServiceRoleClient,
} from '@/server/auth/supabase-client';
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
import {
  PROPERTY_SELECT,
  REVIEW_SELECT,
  toClaim,
  toModerationAction,
  toProperty,
  toReport,
  toReview,
  toUserProfile,
  type ClaimRow,
  type ModerationActionRow,
  type ProfileRow,
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

export class SupabaseRepository implements LivdRepository {
  private async client(): Promise<SupabaseClient> {
    return createServerSupabaseClient();
  }

  /** Service role. Only for moderation paths that have already been authorised. */
  private admin(): SupabaseClient {
    return createServiceRoleClient();
  }

  /* ---------------------------------------------------------------------
   * Properties
   * ------------------------------------------------------------------ */

  async getPropertyBySlug(slug: string): Promise<Property | null> {
    const supabase = await this.client();
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
    const supabase = await this.client();
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
    const supabase = await this.client();
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
    const supabase = await this.client();
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

    const supabase = await this.client();
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

    const supabase = await this.client();
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
    // Scored properties only: a "highest rated" list built on unscored ones
    // would be dishonest.
    return this.discover(options, 'overall_score', { scoredOnly: true });
  }

  private async discover(
    options: DiscoveryOptions,
    orderColumn: string,
    { scoredOnly = false }: { scoredOnly?: boolean } = {},
  ): Promise<PropertySummary[]> {
    const supabase = await this.client();

    let query = supabase
      .from('properties')
      .select(`${PROPERTY_SELECT}, property_stats!inner ( * )`)
      .eq('status', 'active')
      .gt('property_stats.review_count', 0);

    if (options.countryCode) query = query.eq('country_code', options.countryCode.toUpperCase());
    if (!showDemoData()) query = query.eq('is_demo', false);
    if (scoredOnly) query = query.not('property_stats.overall_score', 'is', null);

    const { data, error } = await query
      .order(orderColumn, { referencedTable: 'property_stats', ascending: false, nullsFirst: false })
      .limit(options.limit ?? 6);

    if (error) throw new Error(`discover: ${error.message}`);

    return this.summarise((data ?? []).map((row) => toProperty(row as unknown as PropertyRow)));
  }

  async listLocalities(countryCode?: string | null): Promise<LocalitySummary[]> {
    const supabase = await this.client();

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
    const supabase = await this.client();

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
    const supabase = await this.client();
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
    if (options.verifiedOnly) query = query.eq('verification_level', 'verified_resident');
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
   * Moderation — service role, always behind a guard
   * ------------------------------------------------------------------ */

  async setReviewStatus(
    reviewId: string,
    status: ReviewStatus,
    actorId: string,
    reason: string,
  ): Promise<void> {
    const admin = this.admin();

    const { data: current } = await admin
      .from('reviews')
      .select('status')
      .eq('id', reviewId)
      .maybeSingle();

    const { error } = await admin.from('reviews').update({ status }).eq('id', reviewId);
    if (error) throw new Error(`setReviewStatus: ${error.message}`);

    await admin.from('moderation_actions').insert({
      actor_id: actorId,
      subject_type: 'review',
      subject_id: reviewId,
      action: `set_status:${status}`,
      reason,
      previous_status: (current as { status: string } | null)?.status ?? null,
      new_status: status,
    });
  }

  async setReviewVerification(
    reviewId: string,
    level: VerificationLevel,
    actorId: string,
  ): Promise<void> {
    const admin = this.admin();

    const { error } = await admin
      .from('reviews')
      .update({ verification_level: level })
      .eq('id', reviewId);
    if (error) throw new Error(`setReviewVerification: ${error.message}`);

    await admin.from('moderation_actions').insert({
      actor_id: actorId,
      subject_type: 'review',
      subject_id: reviewId,
      action: `set_verification:${level}`,
      new_status: level,
    });
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

  async resolveReport(
    reportId: string,
    status: Extract<ReportStatus, 'upheld' | 'dismissed'>,
    actorId: string,
    resolution: string,
  ): Promise<void> {
    const admin = this.admin();

    const { data: report, error } = await admin
      .from('review_reports')
      .update({ status, resolution, resolved_at: new Date().toISOString() })
      .eq('id', reportId)
      .select('review_id')
      .single();

    if (error) throw new Error(`resolveReport: ${error.message}`);

    await admin.from('moderation_actions').insert({
      actor_id: actorId,
      subject_type: 'review',
      subject_id: (report as { review_id: string }).review_id,
      action: `report_${status}`,
      reason: resolution,
      new_status: status,
    });
  }

  async recordModerationAction(
    input: Omit<ModerationAction, 'id' | 'createdAt'>,
  ): Promise<ModerationAction> {
    const admin = this.admin();

    const data = unwrap(
      await admin
        .from('moderation_actions')
        .insert({
          actor_id: input.actorId,
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
    actorId: string,
  ): Promise<void> {
    const admin = this.admin();

    const { error } = await admin
      .from('property_claims')
      .update({ status, reviewed_by: actorId, decided_at: new Date().toISOString() })
      .eq('id', claimId);

    if (error) throw new Error(`decideClaim: ${error.message}`);

    await admin.from('moderation_actions').insert({
      actor_id: actorId,
      subject_type: 'claim',
      subject_id: claimId,
      action: `claim_${status}`,
      previous_status: 'pending',
      new_status: status,
    });
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

  async getUserByEmail(email: string): Promise<UserProfile | null> {
    const admin = this.admin();
    const { data, error } = await admin.auth.admin.listUsers();
    if (error) throw new Error(`getUserByEmail: ${error.message}`);

    const authUser = data.users.find(
      (candidate) => candidate.email?.toLowerCase() === email.trim().toLowerCase(),
    );
    if (!authUser) return null;

    const { data: profile } = await admin
      .from('profiles')
      .select('id, role, status, country_code, preferred_locale, created_at')
      .eq('id', authUser.id)
      .maybeSingle();

    return profile
      ? toUserProfile(profile as unknown as ProfileRow, authUser.email ?? '')
      : null;
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

  async listUsers(limit = 100): Promise<UserProfile[]> {
    const admin = this.admin();

    const { data: profiles, error } = await admin
      .from('profiles')
      .select('id, role, status, country_code, preferred_locale, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`listUsers: ${error.message}`);

    const { data: authData } = await admin.auth.admin.listUsers({ perPage: limit });
    const emails = new Map(authData.users.map((user) => [user.id, user.email ?? '']));

    return (profiles ?? []).map((row) => {
      const typed = row as unknown as ProfileRow;
      return toUserProfile(typed, emails.get(typed.id) ?? '');
    });
  }

  async setUserRole(
    userId: string,
    role: UserProfile['role'],
    actorId: string,
  ): Promise<void> {
    const admin = this.admin();

    const { data: current } = await admin
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    const { error } = await admin.from('profiles').update({ role }).eq('id', userId);
    if (error) throw new Error(`setUserRole: ${error.message}`);

    await admin.from('moderation_actions').insert({
      actor_id: actorId,
      subject_type: 'user',
      subject_id: userId,
      action: `set_role:${role}`,
      previous_status: (current as { role: string } | null)?.role ?? null,
      new_status: role,
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
    const supabase = await this.client();

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
      pendingClaimCount,
      userCount,
      reviewsLast30Days,
    ] = await Promise.all([
      count('properties', (q) => (q as never as { eq: Function }).eq('status', 'active')),
      count('reviews', (q) => (q as never as { eq: Function }).eq('status', 'published')),
      count('reviews', (q) => (q as never as { eq: Function }).eq('status', 'pending_moderation')),
      count('review_reports', (q) => (q as never as { eq: Function }).eq('status', 'open')),
      count('property_claims', (q) => (q as never as { eq: Function }).eq('status', 'pending')),
      count('profiles'),
      count('reviews', (q) => (q as never as { gte: Function }).gte('created_at', thirtyDaysAgo)),
    ]);

    return {
      propertyCount,
      reviewCount,
      pendingModerationCount,
      openReportCount,
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
