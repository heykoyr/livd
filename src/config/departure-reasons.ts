/**
 * Why residents leave.
 *
 * The most differentiated dataset Livd holds. Captured as structured choices
 * rather than free text so it can be aggregated honestly across a property's
 * whole history.
 *
 * `isPropertyRelated` separates reasons that say something about the property
 * from reasons that say something about the resident's life. A property where
 * everyone left because they bought a house is not a bad property, and the
 * aggregate must not imply otherwise.
 *
 * `isSensitive` marks reasons that are counted in aggregates but never rendered
 * as a headline or a quotable statistic — surfacing "40% left because of
 * harassment" against a specific address invites exactly the kind of targeting
 * the platform exists to prevent.
 */

export interface DepartureReasonDefinition {
  key: string;
  label: string;
  /** Used in the verdict and timeline sentences. */
  phrase: string;
  isPropertyRelated: boolean;
  isSensitive: boolean;
  /** Category this reason corroborates, when there is one. */
  relatedCategory: string | null;
  sortOrder: number;
}

export const DEPARTURE_REASONS: DepartureReasonDefinition[] = [
  {
    key: 'rent_increase',
    label: 'Rent increase',
    phrase: 'a rent increase',
    isPropertyRelated: true,
    isSensitive: false,
    relatedCategory: 'value',
    sortOrder: 10,
  },
  {
    key: 'maintenance',
    label: 'Maintenance and repairs',
    phrase: 'unresolved maintenance',
    isPropertyRelated: true,
    isSensitive: false,
    relatedCategory: 'building_maintenance',
    sortOrder: 20,
  },
  {
    key: 'management',
    label: 'Landlord or management',
    phrase: 'problems with management',
    isPropertyRelated: true,
    isSensitive: false,
    relatedCategory: 'management',
    sortOrder: 30,
  },
  {
    key: 'utilities',
    label: 'Utilities and services',
    phrase: 'unreliable utilities',
    isPropertyRelated: true,
    isSensitive: false,
    relatedCategory: 'utilities',
    sortOrder: 40,
  },
  {
    key: 'noise',
    label: 'Noise',
    phrase: 'noise',
    isPropertyRelated: true,
    isSensitive: false,
    relatedCategory: 'noise',
    sortOrder: 50,
  },
  {
    key: 'safety',
    label: 'Safety or security concerns',
    phrase: 'safety concerns',
    isPropertyRelated: true,
    isSensitive: true,
    relatedCategory: 'safety',
    sortOrder: 60,
  },
  {
    key: 'neighbours',
    label: 'Neighbours',
    phrase: 'problems with neighbours',
    isPropertyRelated: true,
    isSensitive: true,
    relatedCategory: 'neighbours',
    sortOrder: 70,
  },
  {
    key: 'condition',
    label: 'Condition of the home',
    phrase: 'the condition of the home',
    isPropertyRelated: true,
    isSensitive: false,
    relatedCategory: 'building_maintenance',
    sortOrder: 80,
  },
  {
    key: 'space',
    label: 'Needed more or less space',
    phrase: 'needing different space',
    isPropertyRelated: false,
    isSensitive: false,
    relatedCategory: null,
    sortOrder: 90,
  },
  {
    key: 'deposit_dispute',
    label: 'Deposit or contract dispute',
    phrase: 'a deposit or contract dispute',
    isPropertyRelated: true,
    isSensitive: false,
    relatedCategory: 'management',
    sortOrder: 100,
  },
  {
    key: 'lease_ended',
    label: 'Lease ended or was not renewed',
    phrase: 'the lease ending',
    isPropertyRelated: true,
    isSensitive: false,
    relatedCategory: null,
    sortOrder: 110,
  },
  {
    key: 'relocation',
    label: 'Moved city or country',
    phrase: 'relocating',
    isPropertyRelated: false,
    isSensitive: false,
    relatedCategory: null,
    sortOrder: 120,
  },
  {
    key: 'work_study',
    label: 'Work or study change',
    phrase: 'a change of work or study',
    isPropertyRelated: false,
    isSensitive: false,
    relatedCategory: null,
    sortOrder: 130,
  },
  {
    key: 'life_change',
    label: 'Personal or household change',
    phrase: 'a change in circumstances',
    isPropertyRelated: false,
    isSensitive: false,
    relatedCategory: null,
    sortOrder: 140,
  },
  {
    key: 'bought_home',
    label: 'Bought a home',
    phrase: 'buying a home',
    isPropertyRelated: false,
    isSensitive: false,
    relatedCategory: null,
    sortOrder: 150,
  },
  {
    key: 'commute',
    label: 'Commute or location',
    phrase: 'the commute',
    isPropertyRelated: true,
    isSensitive: false,
    relatedCategory: 'location',
    sortOrder: 160,
  },
  {
    key: 'other',
    label: 'Something else',
    phrase: 'other reasons',
    isPropertyRelated: false,
    isSensitive: false,
    relatedCategory: null,
    sortOrder: 999,
  },
];

const BY_KEY = new Map(DEPARTURE_REASONS.map((r) => [r.key, r]));

export function getDepartureReason(key: string): DepartureReasonDefinition | undefined {
  return BY_KEY.get(key);
}

export function departureReasonLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key;
}

export const DEPARTURE_REASONS_SORTED = [...DEPARTURE_REASONS].sort(
  (a, b) => a.sortOrder - b.sortOrder,
);

/**
 * Minimum former residents who gave a reason before a distribution is published.
 *
 * Below this, one person's answer becomes "100% left because of X", which is
 * both misleading and potentially identifying. The section explains its own
 * absence instead.
 */
export const DEPARTURE_DISCLOSURE_THRESHOLD = 4;
