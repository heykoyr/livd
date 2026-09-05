/**
 * Review categories.
 *
 * Core categories are asked of every resident in every market and are what the
 * Livd Score is built from. Extended categories are offered when the market
 * suggests them or the resident opts in, and are scored only where residents
 * actually rated them — so a London flat is never scored on generator
 * reliability, and a Lagos apartment is never scored on central heating.
 *
 * `weight` is the category's contribution to the overall score. The weights of
 * the core set are normalised at calculation time, so they express relative
 * importance rather than needing to sum to 1.
 */

export interface CategoryDefinition {
  key: string;
  label: string;
  /** Shown under the label on the property page. */
  description: string;
  /** The question a reviewer is asked. Phrased about the property, never a person. */
  prompt: string;
  isCore: boolean;
  weight: number;
  /** Null means globally relevant; otherwise offered in these markets. */
  appliesToCountries: string[] | null;
  sortOrder: number;
}

export const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  /* ---------------- Core — asked everywhere ---------------- */
  {
    key: 'building_maintenance',
    label: 'Building & maintenance',
    description: 'Condition of the building and how quickly repairs get done',
    prompt: 'How well was the building maintained, and how quickly were repairs handled?',
    isCore: true,
    weight: 1.35,
    appliesToCountries: null,
    sortOrder: 10,
  },
  {
    key: 'management',
    label: 'Management & landlord',
    description: 'Responsiveness, fairness and how issues were handled',
    prompt: 'How was the landlord or property manager to deal with?',
    isCore: true,
    weight: 1.35,
    appliesToCountries: null,
    sortOrder: 20,
  },
  {
    key: 'value',
    label: 'Value for money',
    description: 'What you got for the rent you paid',
    prompt: 'Was the rent fair for what you got?',
    isCore: true,
    weight: 1.15,
    appliesToCountries: null,
    sortOrder: 30,
  },
  {
    key: 'safety',
    label: 'Safety & security',
    description: 'How safe the building and immediate area felt',
    prompt: 'How safe did the building and the immediate area feel?',
    isCore: true,
    weight: 1.25,
    appliesToCountries: null,
    sortOrder: 40,
  },
  {
    key: 'noise',
    label: 'Noise',
    description: 'Sound from neighbours, traffic and the surrounding area',
    prompt: 'How quiet was it, day and night?',
    isCore: true,
    weight: 1.0,
    appliesToCountries: null,
    sortOrder: 50,
  },
  {
    key: 'utilities',
    label: 'Utilities & services',
    description: 'Reliability of the essential services the home depends on',
    prompt: 'How reliable were the essential services — water, power, heating?',
    isCore: true,
    weight: 1.2,
    appliesToCountries: null,
    sortOrder: 60,
  },
  {
    key: 'neighbours',
    label: 'Neighbours & community',
    description: 'What the people around you were like to live alongside',
    prompt: 'What was it like living alongside the other residents?',
    isCore: true,
    weight: 0.9,
    appliesToCountries: null,
    sortOrder: 70,
  },
  {
    key: 'location',
    label: 'Location & transport',
    description: 'Getting around, and what is within reach day to day',
    prompt: 'How was the location for getting around and day-to-day needs?',
    isCore: true,
    weight: 1.0,
    appliesToCountries: null,
    sortOrder: 80,
  },

  /* ---------------- Extended — surfaced on evidence ---------------- */
  {
    key: 'water_supply',
    label: 'Water supply',
    description: 'Availability, pressure and quality of water',
    prompt: 'How reliable was the water supply?',
    isCore: false,
    weight: 1.1,
    appliesToCountries: ['NG', 'ZA', 'IN', 'AE'],
    sortOrder: 100,
  },
  {
    key: 'power_reliability',
    label: 'Power reliability',
    description: 'How often the electricity supply failed, and backup provision',
    prompt: 'How reliable was the electricity supply?',
    isCore: false,
    weight: 1.1,
    appliesToCountries: ['NG', 'ZA', 'IN'],
    sortOrder: 110,
  },
  {
    key: 'heating_cooling',
    label: 'Heating & cooling',
    description: 'Keeping the home comfortable through the year',
    prompt: 'How well did heating and cooling keep the home comfortable?',
    isCore: false,
    weight: 1.0,
    appliesToCountries: ['US', 'GB', 'CA', 'AU', 'DE', 'NL', 'FR', 'IE', 'AE'],
    sortOrder: 120,
  },
  {
    key: 'damp_mould',
    label: 'Damp & mould',
    description: 'Moisture problems affecting the home',
    prompt: 'Were there problems with damp, condensation or mould?',
    isCore: false,
    weight: 1.05,
    appliesToCountries: ['GB', 'IE', 'NL', 'DE', 'FR', 'AU', 'ZA'],
    sortOrder: 130,
  },
  {
    key: 'internet',
    label: 'Internet & connectivity',
    description: 'Broadband and mobile signal in the home',
    prompt: 'How was internet and mobile signal inside the home?',
    isCore: false,
    weight: 0.85,
    appliesToCountries: null,
    sortOrder: 140,
  },
  {
    key: 'cleanliness',
    label: 'Cleanliness & waste',
    description: 'Shared areas, bins and general upkeep',
    prompt: 'How clean and well kept were the shared areas and bin facilities?',
    isCore: false,
    weight: 0.9,
    appliesToCountries: null,
    sortOrder: 150,
  },
  {
    key: 'parking',
    label: 'Parking',
    description: 'Availability and security of parking',
    prompt: 'How was parking — availability, cost and security?',
    isCore: false,
    weight: 0.7,
    appliesToCountries: null,
    sortOrder: 160,
  },
  {
    key: 'accessibility',
    label: 'Accessibility',
    description: 'Step-free access, lifts and getting around the building',
    prompt: 'How accessible was the building — entrances, lifts, stairs?',
    isCore: false,
    weight: 0.8,
    appliesToCountries: null,
    sortOrder: 170,
  },
  {
    key: 'drainage',
    label: 'Drainage & flooding',
    description: 'How the property handles heavy rain',
    prompt: 'Did the property have drainage or flooding problems in heavy rain?',
    isCore: false,
    weight: 1.05,
    appliesToCountries: ['NG', 'IN', 'ZA', 'US', 'AU'],
    sortOrder: 180,
  },
  {
    key: 'pests',
    label: 'Pests',
    description: 'Infestations and how they were dealt with',
    prompt: 'Were there pest problems, and were they dealt with?',
    isCore: false,
    weight: 1.0,
    appliesToCountries: null,
    sortOrder: 190,
  },
  {
    key: 'natural_light',
    label: 'Natural light & ventilation',
    description: 'Daylight and airflow through the home',
    prompt: 'How was natural light and ventilation in the home?',
    isCore: false,
    weight: 0.75,
    appliesToCountries: null,
    sortOrder: 200,
  },
  {
    key: 'laundry',
    label: 'Laundry',
    description: 'In-home or shared laundry provision',
    prompt: 'How was the laundry provision?',
    isCore: false,
    weight: 0.6,
    appliesToCountries: ['US', 'CA', 'AU', 'GB'],
    sortOrder: 210,
  },
  {
    key: 'bike_storage',
    label: 'Bike storage',
    description: 'Secure space for bicycles',
    prompt: 'How was secure bike storage?',
    isCore: false,
    weight: 0.55,
    appliesToCountries: ['NL', 'DE', 'GB', 'DK'],
    sortOrder: 220,
  },
];

const BY_KEY = new Map(CATEGORY_DEFINITIONS.map((c) => [c.key, c]));

export function getCategory(key: string): CategoryDefinition | undefined {
  return BY_KEY.get(key);
}

export function categoryLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key;
}

export const CORE_CATEGORIES = CATEGORY_DEFINITIONS.filter((c) => c.isCore).sort(
  (a, b) => a.sortOrder - b.sortOrder,
);

export const EXTENDED_CATEGORIES = CATEGORY_DEFINITIONS.filter((c) => !c.isCore).sort(
  (a, b) => a.sortOrder - b.sortOrder,
);

/**
 * Extended categories a reviewer in this market is offered up front. The rest
 * remain available behind "add another category", so nothing is unreachable.
 */
export function suggestedExtendedCategories(
  countryCode: string | null | undefined,
): CategoryDefinition[] {
  const code = countryCode?.toUpperCase();
  return EXTENDED_CATEGORIES.filter(
    (c) => c.appliesToCountries === null || (code != null && c.appliesToCountries.includes(code)),
  );
}
