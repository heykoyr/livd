import type { PropertyTypeKey, RentPeriod } from '@/types/domain';

/**
 * What differs between markets in the sample dataset.
 *
 * Only the things a resident of that market would notice were wrong: how rent
 * is quoted (Lagos and Dubai by the year, everywhere else by the month), what
 * kinds of home there are, how old the buildings tend to be, and the words
 * people use — a flat or an apartment, a lift or an elevator, the letting
 * agent or the body corporate.
 */

export interface MarketFlavour {
  rent: {
    period: RentPeriod;
    /** A typical home at rent index 1, in minor units of the market currency. */
    baseMinor: number;
    /** Quoted rents are rounded to this, in minor units — nobody pays ₦1,483,112. */
    roundMinor: number;
    /** Year-on-year growth, for rents reported in earlier years. */
    annualGrowth: number;
  };
  propertyTypes: ReadonlyArray<readonly [PropertyTypeKey, number]>;
  /** Oldest and newest plausible year built for this market's rental stock. */
  yearBuilt: readonly [number, number];
  /** Typical unit counts for a block of flats here. */
  blockUnits: readonly [number, number];
  /** Which name bank building names are drawn from. */
  nameStyle: 'english' | 'nigerian' | 'german' | 'dutch' | 'french' | 'southern-african' | 'gulf' | 'indian';
  vocabulary: Vocabulary;
  /**
   * Which infrastructure themes residents here actually write about. A power
   * cut is ordinary in Lagos and Johannesburg and unheard of in Amsterdam; a
   * boiler is a British preoccupation and a chiller a Gulf one.
   */
  concerns: readonly Concern[];
}

export type Concern =
  | 'power'
  | 'water'
  | 'flooding'
  | 'heating'
  | 'cooling'
  | 'damp'
  | 'security'
  | 'charges'
  | 'laundry'
  | 'transit';

/** Words substituted into prose so it reads as written in that market. */
export interface Vocabulary {
  flat: readonly string[];
  lift: string;
  bins: string;
  neighbours: string;
  /** Whoever the resident dealt with about the building. */
  manager: readonly string[];
  /** The backup when the power goes, where there is one. */
  backup: string;
  heating: string;
  cooling: string;
  /** What the building charges on top of rent. */
  charges: string;
  transit: readonly string[];
  /** Colour/neighbour spelling. */
  american: boolean;
}

const BRITISH: Omit<Vocabulary, 'manager' | 'transit' | 'charges'> = {
  flat: ['flat'],
  lift: 'lift',
  bins: 'bins',
  neighbours: 'neighbours',
  backup: 'backup generator',
  heating: 'boiler',
  cooling: 'air conditioning',
  american: false,
};

export const FLAVOURS: Record<string, MarketFlavour> = {
  NG: {
    rent: { period: 'year', baseMinor: 150_000_000, roundMinor: 5_000_000, annualGrowth: 1.16 },
    propertyTypes: [
      ['apartment', 55],
      ['duplex', 14],
      ['bungalow', 8],
      ['house', 6],
      ['studio', 9],
      ['shared', 5],
      ['room', 3],
    ],
    yearBuilt: [1978, 2025],
    blockUnits: [4, 36],
    nameStyle: 'nigerian',
    vocabulary: {
      ...BRITISH,
      flat: ['flat', 'apartment'],
      manager: ['the landlord', 'the agent', 'the caretaker', 'the facility manager'],
      backup: 'generator',
      heating: 'water heater',
      cooling: 'AC',
      charges: 'service charge',
      transit: ['the main road', 'the bus stop', 'the expressway'],
    },
    concerns: ['power', 'water', 'flooding', 'security', 'charges', 'transit'],
  },
  GB: {
    rent: { period: 'month', baseMinor: 100_000, roundMinor: 2_500, annualGrowth: 1.06 },
    propertyTypes: [
      ['apartment', 58],
      ['townhouse', 12],
      ['house', 7],
      ['shared', 11],
      ['studio', 8],
      ['duplex', 4],
    ],
    yearBuilt: [1870, 2024],
    blockUnits: [4, 160],
    nameStyle: 'english',
    vocabulary: {
      ...BRITISH,
      manager: ['the landlord', 'the letting agent', 'the managing agent', 'the agency'],
      charges: 'service charge',
      transit: ['the station', 'the bus stop', 'the high street'],
    },
    concerns: ['heating', 'damp', 'charges', 'transit'],
  },
  US: {
    rent: { period: 'month', baseMinor: 150_000, roundMinor: 2_500, annualGrowth: 1.045 },
    propertyTypes: [
      ['apartment', 74],
      ['studio', 9],
      ['townhouse', 6],
      ['house', 6],
      ['shared', 5],
    ],
    yearBuilt: [1905, 2025],
    blockUnits: [6, 320],
    nameStyle: 'english',
    vocabulary: {
      flat: ['apartment', 'unit'],
      lift: 'elevator',
      bins: 'trash',
      neighbours: 'neighbors',
      manager: ['management', 'the super', 'the property manager', 'the leasing office'],
      backup: 'backup generator',
      heating: 'heat',
      cooling: 'AC',
      charges: 'fees',
      transit: ['the train', 'the bus line', 'transit'],
      american: true,
    },
    concerns: ['heating', 'cooling', 'laundry', 'charges', 'transit'],
  },
  CA: {
    rent: { period: 'month', baseMinor: 170_000, roundMinor: 2_500, annualGrowth: 1.05 },
    propertyTypes: [
      ['apartment', 70],
      ['duplex', 9],
      ['townhouse', 7],
      ['house', 5],
      ['studio', 6],
      ['shared', 3],
    ],
    yearBuilt: [1920, 2025],
    blockUnits: [6, 280],
    nameStyle: 'english',
    vocabulary: {
      ...BRITISH,
      flat: ['apartment', 'unit'],
      lift: 'elevator',
      bins: 'garbage room',
      manager: ['the property manager', 'the super', 'management', 'the landlord'],
      heating: 'heating',
      cooling: 'AC',
      charges: 'fees',
      transit: ['transit', 'the streetcar', 'the bus'],
    },
    concerns: ['heating', 'laundry', 'transit'],
  },
  AU: {
    rent: { period: 'month', baseMinor: 240_000, roundMinor: 2_500, annualGrowth: 1.06 },
    propertyTypes: [
      ['apartment', 62],
      ['townhouse', 12],
      ['house', 10],
      ['studio', 6],
      ['shared', 10],
    ],
    yearBuilt: [1900, 2025],
    blockUnits: [4, 220],
    nameStyle: 'english',
    vocabulary: {
      ...BRITISH,
      flat: ['unit', 'apartment'],
      manager: ['the agent', 'the property manager', 'the strata', 'the landlord'],
      heating: 'heating',
      cooling: 'air con',
      charges: 'strata fees',
      transit: ['the train', 'the bus', 'the light rail'],
    },
    concerns: ['cooling', 'damp', 'transit'],
  },
  IE: {
    rent: { period: 'month', baseMinor: 170_000, roundMinor: 2_500, annualGrowth: 1.07 },
    propertyTypes: [
      ['apartment', 58],
      ['house', 14],
      ['townhouse', 10],
      ['shared', 12],
      ['studio', 6],
    ],
    yearBuilt: [1870, 2024],
    blockUnits: [4, 140],
    nameStyle: 'english',
    vocabulary: {
      ...BRITISH,
      flat: ['apartment', 'flat'],
      manager: ['the landlord', 'the letting agent', 'the management company'],
      heating: 'heating',
      charges: 'management fees',
      transit: ['the Luas', 'the bus', 'the DART'],
    },
    concerns: ['heating', 'damp', 'transit'],
  },
  DE: {
    rent: { period: 'month', baseMinor: 90_000, roundMinor: 1_000, annualGrowth: 1.04 },
    propertyTypes: [
      ['apartment', 84],
      ['shared', 11],
      ['studio', 5],
    ],
    yearBuilt: [1885, 2024],
    blockUnits: [6, 90],
    nameStyle: 'german',
    vocabulary: {
      ...BRITISH,
      flat: ['flat', 'apartment'],
      manager: ['the Hausverwaltung', 'the landlord', 'the property management'],
      heating: 'heating',
      charges: 'Nebenkosten',
      transit: ['the U-Bahn', 'the tram', 'the S-Bahn'],
    },
    concerns: ['heating', 'damp', 'charges', 'transit'],
  },
  NL: {
    rent: { period: 'month', baseMinor: 140_000, roundMinor: 1_000, annualGrowth: 1.05 },
    propertyTypes: [
      ['apartment', 78],
      ['shared', 10],
      ['studio', 8],
      ['house', 4],
    ],
    yearBuilt: [1890, 2024],
    blockUnits: [4, 120],
    nameStyle: 'dutch',
    vocabulary: {
      ...BRITISH,
      flat: ['apartment', 'flat'],
      manager: ['the landlord', 'the housing corporation', 'the property manager'],
      heating: 'heating',
      charges: 'service costs',
      transit: ['the tram', 'the station', 'the metro'],
    },
    concerns: ['heating', 'damp', 'charges', 'transit'],
  },
  FR: {
    rent: { period: 'month', baseMinor: 90_000, roundMinor: 1_000, annualGrowth: 1.035 },
    propertyTypes: [
      ['apartment', 78],
      ['studio', 16],
      ['shared', 6],
    ],
    yearBuilt: [1850, 2024],
    blockUnits: [6, 80],
    nameStyle: 'french',
    vocabulary: {
      ...BRITISH,
      flat: ['apartment', 'flat'],
      manager: ['the agency', 'the landlord', 'the syndic'],
      heating: 'heating',
      charges: 'charges',
      transit: ['the métro', 'the tram', 'the station'],
    },
    concerns: ['heating', 'damp', 'charges', 'transit'],
  },
  ZA: {
    rent: { period: 'month', baseMinor: 900_000, roundMinor: 25_000, annualGrowth: 1.06 },
    propertyTypes: [
      ['apartment', 50],
      ['townhouse', 24],
      ['house', 14],
      ['studio', 6],
      ['shared', 6],
    ],
    yearBuilt: [1955, 2024],
    blockUnits: [6, 120],
    nameStyle: 'southern-african',
    vocabulary: {
      ...BRITISH,
      flat: ['flat', 'unit', 'apartment'],
      manager: ['the body corporate', 'the managing agent', 'the landlord', 'the agent'],
      backup: 'inverter',
      heating: 'geyser',
      charges: 'levies',
      transit: ['the Gautrain', 'the main road', 'the taxi rank'],
    },
    concerns: ['power', 'water', 'security', 'charges'],
  },
  AE: {
    rent: { period: 'year', baseMinor: 7_000_000, roundMinor: 100_000, annualGrowth: 1.07 },
    propertyTypes: [
      ['apartment', 80],
      ['studio', 12],
      ['townhouse', 5],
      ['house', 3],
    ],
    yearBuilt: [2000, 2025],
    blockUnits: [40, 480],
    nameStyle: 'gulf',
    vocabulary: {
      ...BRITISH,
      flat: ['apartment', 'unit'],
      manager: ['the landlord', 'building management', 'the agent', 'the facilities team'],
      heating: 'water heater',
      cooling: 'AC',
      charges: 'chiller charges',
      transit: ['the metro', 'the tram', 'the main road'],
    },
    concerns: ['cooling', 'charges', 'transit'],
  },
  IN: {
    rent: { period: 'month', baseMinor: 2_500_000, roundMinor: 50_000, annualGrowth: 1.07 },
    propertyTypes: [
      ['apartment', 78],
      ['house', 5],
      ['studio', 6],
      ['shared', 6],
      ['duplex', 5],
    ],
    yearBuilt: [1980, 2025],
    blockUnits: [12, 360],
    nameStyle: 'indian',
    vocabulary: {
      ...BRITISH,
      flat: ['flat', 'apartment'],
      manager: ['the owner', 'the society office', 'the broker', 'the building management'],
      backup: 'power backup',
      heating: 'geyser',
      cooling: 'AC',
      charges: 'maintenance charges',
      transit: ['the metro', 'the main road', 'the station'],
    },
    concerns: ['power', 'water', 'flooding', 'cooling', 'charges', 'transit'],
  },
};

export function flavourFor(countryCode: string): MarketFlavour {
  const flavour = FLAVOURS[countryCode.toUpperCase()];
  if (!flavour) throw new Error(`No sample-data flavour for market ${countryCode}`);
  return flavour;
}
