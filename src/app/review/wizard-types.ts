import type { WizardProperty } from '@/server/actions/property-lookup';

/**
 * The review draft, as the wizard holds it.
 *
 * Kept separate from the validated schema type because the wizard's version is
 * legitimately incomplete while it is being filled in — nullable ratings, an
 * unchosen property. Validation happens at the boundary, not continuously.
 */
export interface WizardDraft {
  property: WizardProperty | null;
  residencyStatus: 'current' | 'former' | null;
  movedInMonth: string | null;
  movedOutMonth: string | null;
  overallRating: number | null;
  categoryRatings: Record<string, number>;
  /** Categories the reviewer explicitly said did not apply, so they stay skipped. */
  skippedCategories: string[];
  positiveTags: string[];
  problemTags: string[];
  primaryDepartureReason: string | null;
  secondaryDepartureReasons: string[];
  noticedManagementChange: boolean | null;
  body: string;
  wouldRecommend: boolean | null;
  rentAmount: string;
  rentCurrency: string;
  rentPeriod: 'month' | 'year';
  confirmedGuidelines: boolean;
}

export function emptyDraft(property: WizardProperty | null): WizardDraft {
  return {
    property,
    residencyStatus: null,
    movedInMonth: null,
    movedOutMonth: null,
    overallRating: null,
    categoryRatings: {},
    skippedCategories: [],
    positiveTags: [],
    problemTags: [],
    primaryDepartureReason: null,
    secondaryDepartureReasons: [],
    noticedManagementChange: null,
    body: '',
    wouldRecommend: null,
    rentAmount: '',
    rentCurrency: '',
    rentPeriod: 'month',
    confirmedGuidelines: false,
  };
}

export type StepId =
  | 'property'
  | 'residency'
  | 'dates'
  | 'overall'
  | 'categories'
  | 'positives'
  | 'problems'
  | 'departure'
  | 'words'
  | 'confirm';

/**
 * The steps this reviewer will see.
 *
 * Progressive disclosure is the whole point of the flow: a current resident is
 * never asked why they left, and someone who arrived from a property page is
 * never asked which property they mean. Computing the sequence from the draft
 * — rather than skipping steps at render time — keeps "step 4 of 8" honest.
 */
export function stepsFor(draft: WizardDraft, propertyPreselected: boolean): StepId[] {
  const steps: StepId[] = [];

  if (!propertyPreselected) steps.push('property');

  steps.push('residency', 'dates', 'overall', 'categories', 'positives', 'problems');

  if (draft.residencyStatus === 'former') steps.push('departure');

  steps.push('words', 'confirm');

  return steps;
}

/** Converts the wizard's working shape into the payload the schema expects. */
export function toSubmitPayload(draft: WizardDraft): Record<string, unknown> {
  const rentAmount = Number.parseFloat(draft.rentAmount.replace(/[^\d.]/g, ''));
  const hasRent =
    draft.rentAmount.trim().length > 0 &&
    Number.isFinite(rentAmount) &&
    rentAmount > 0 &&
    draft.rentCurrency.length === 3;

  return {
    propertyId: draft.property?.id ?? '',
    residencyStatus: draft.residencyStatus,
    movedInMonth: draft.movedInMonth,
    movedOutMonth: draft.residencyStatus === 'former' ? draft.movedOutMonth : null,
    overallRating: draft.overallRating,
    categoryRatings: Object.entries(draft.categoryRatings).map(([categoryKey, rating]) => ({
      categoryKey,
      rating,
    })),
    positiveTags: draft.positiveTags,
    problemTags: draft.problemTags,
    primaryDepartureReason:
      draft.residencyStatus === 'former' ? draft.primaryDepartureReason : null,
    secondaryDepartureReasons:
      draft.residencyStatus === 'former' ? draft.secondaryDepartureReasons : [],
    noticedManagementChange: draft.noticedManagementChange,
    body: draft.body.trim().length > 0 ? draft.body.trim() : null,
    wouldRecommend: draft.wouldRecommend ?? false,
    // Minor units. Stored as an integer so no float ever touches money.
    rentAmountMinor: hasRent ? Math.round(rentAmount * 100) : null,
    rentCurrency: hasRent ? draft.rentCurrency : null,
    rentPeriod: hasRent ? draft.rentPeriod : null,
    confirmedGuidelines: draft.confirmedGuidelines,
  };
}
