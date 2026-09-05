/**
 * Structured tags behind "what was good" and "what was difficult".
 *
 * Chips rather than free text, because a chip can be aggregated across a
 * property's whole history and free prose cannot. Every tag is about the
 * property or the experience of living in it — never about an identifiable
 * person.
 */

export interface TagDefinition {
  key: string;
  label: string;
  polarity: 'positive' | 'problem';
  /** Category this tag corroborates, when there is one. */
  categoryKey: string | null;
  sortOrder: number;
}

export const TAG_DEFINITIONS: TagDefinition[] = [
  /* ------------------------- Positive ------------------------- */
  { key: 'responsive_repairs', label: 'Repairs handled quickly', polarity: 'positive', categoryKey: 'building_maintenance', sortOrder: 10 },
  { key: 'fair_landlord', label: 'Fair, straightforward landlord', polarity: 'positive', categoryKey: 'management', sortOrder: 20 },
  { key: 'deposit_returned', label: 'Deposit returned in full', polarity: 'positive', categoryKey: 'management', sortOrder: 30 },
  { key: 'good_value', label: 'Good value for the rent', polarity: 'positive', categoryKey: 'value', sortOrder: 40 },
  { key: 'feels_safe', label: 'Felt safe', polarity: 'positive', categoryKey: 'safety', sortOrder: 50 },
  { key: 'quiet', label: 'Quiet', polarity: 'positive', categoryKey: 'noise', sortOrder: 60 },
  { key: 'good_light', label: 'Lots of natural light', polarity: 'positive', categoryKey: 'natural_light', sortOrder: 70 },
  { key: 'well_connected', label: 'Well connected for transport', polarity: 'positive', categoryKey: 'location', sortOrder: 80 },
  { key: 'friendly_neighbours', label: 'Good neighbours', polarity: 'positive', categoryKey: 'neighbours', sortOrder: 90 },
  { key: 'clean_shared_areas', label: 'Shared areas kept clean', polarity: 'positive', categoryKey: 'cleanliness', sortOrder: 100 },
  { key: 'reliable_utilities', label: 'Reliable utilities', polarity: 'positive', categoryKey: 'utilities', sortOrder: 110 },
  { key: 'good_storage', label: 'Plenty of storage', polarity: 'positive', categoryKey: null, sortOrder: 120 },
  { key: 'outdoor_space', label: 'Usable outdoor space', polarity: 'positive', categoryKey: null, sortOrder: 130 },
  { key: 'good_internet', label: 'Fast, reliable internet', polarity: 'positive', categoryKey: 'internet', sortOrder: 140 },
  { key: 'secure_entry', label: 'Secure entry', polarity: 'positive', categoryKey: 'safety', sortOrder: 150 },
  { key: 'easy_parking', label: 'Easy parking', polarity: 'positive', categoryKey: 'parking', sortOrder: 160 },
  { key: 'step_free', label: 'Step-free access', polarity: 'positive', categoryKey: 'accessibility', sortOrder: 170 },

  /* ------------------------- Problems ------------------------- */
  { key: 'slow_repairs', label: 'Repairs took a long time', polarity: 'problem', categoryKey: 'building_maintenance', sortOrder: 200 },
  { key: 'unresponsive_management', label: 'Hard to get hold of management', polarity: 'problem', categoryKey: 'management', sortOrder: 210 },
  { key: 'deposit_withheld', label: 'Problems getting the deposit back', polarity: 'problem', categoryKey: 'management', sortOrder: 220 },
  { key: 'unexpected_charges', label: 'Unexpected charges', polarity: 'problem', categoryKey: 'value', sortOrder: 230 },
  { key: 'steep_rent_rises', label: 'Steep rent increases', polarity: 'problem', categoryKey: 'value', sortOrder: 240 },
  { key: 'noise_neighbours', label: 'Noise through walls or floors', polarity: 'problem', categoryKey: 'noise', sortOrder: 250 },
  { key: 'noise_street', label: 'Street or traffic noise', polarity: 'problem', categoryKey: 'noise', sortOrder: 260 },
  { key: 'damp_mould', label: 'Damp or mould', polarity: 'problem', categoryKey: 'damp_mould', sortOrder: 270 },
  { key: 'cold_in_winter', label: 'Hard to keep warm', polarity: 'problem', categoryKey: 'heating_cooling', sortOrder: 280 },
  { key: 'hot_in_summer', label: 'Hard to keep cool', polarity: 'problem', categoryKey: 'heating_cooling', sortOrder: 290 },
  { key: 'water_interruptions', label: 'Water interruptions', polarity: 'problem', categoryKey: 'water_supply', sortOrder: 300 },
  { key: 'power_cuts', label: 'Frequent power cuts', polarity: 'problem', categoryKey: 'power_reliability', sortOrder: 310 },
  { key: 'pests', label: 'Pests', polarity: 'problem', categoryKey: 'pests', sortOrder: 320 },
  { key: 'poor_security', label: 'Security felt inadequate', polarity: 'problem', categoryKey: 'safety', sortOrder: 330 },
  { key: 'dirty_shared_areas', label: 'Shared areas poorly kept', polarity: 'problem', categoryKey: 'cleanliness', sortOrder: 340 },
  { key: 'waste_issues', label: 'Bin and waste problems', polarity: 'problem', categoryKey: 'cleanliness', sortOrder: 350 },
  { key: 'plumbing', label: 'Recurring plumbing problems', polarity: 'problem', categoryKey: 'building_maintenance', sortOrder: 360 },
  { key: 'weak_internet', label: 'Poor internet or signal', polarity: 'problem', categoryKey: 'internet', sortOrder: 370 },
  { key: 'parking_difficult', label: 'Parking was difficult', polarity: 'problem', categoryKey: 'parking', sortOrder: 380 },
  { key: 'flooding', label: 'Flooding or drainage problems', polarity: 'problem', categoryKey: 'drainage', sortOrder: 390 },
  { key: 'lift_outages', label: 'Lift frequently out of service', polarity: 'problem', categoryKey: 'accessibility', sortOrder: 400 },
  { key: 'dark_rooms', label: 'Rooms felt dark', polarity: 'problem', categoryKey: 'natural_light', sortOrder: 410 },
  { key: 'small_space', label: 'Smaller than it looked', polarity: 'problem', categoryKey: null, sortOrder: 420 },
];

const BY_KEY = new Map(TAG_DEFINITIONS.map((t) => [t.key, t]));

export function getTag(key: string): TagDefinition | undefined {
  return BY_KEY.get(key);
}

export function tagLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key;
}

export const POSITIVE_TAGS = TAG_DEFINITIONS.filter((t) => t.polarity === 'positive').sort(
  (a, b) => a.sortOrder - b.sortOrder,
);

export const PROBLEM_TAGS = TAG_DEFINITIONS.filter((t) => t.polarity === 'problem').sort(
  (a, b) => a.sortOrder - b.sortOrder,
);
