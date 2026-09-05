/**
 * Market configuration.
 *
 * Everything that differs between countries lives here as data: address
 * structure, the word a country uses for its first-level subdivision, the local
 * word for a rental home, and the default currency.
 *
 * Adding a market is an edit to this file plus a row in `countries`. It is never
 * a code branch, and there is no "default market" anywhere in the application.
 */

import type { CountryCode, CurrencyCode, PropertyTypeKey } from '@/types/domain';

export interface MarketConfig {
  code: CountryCode;
  name: string;
  defaultCurrency: CurrencyCode;
  /** Locale used for Intl formatting when the user has expressed no preference. */
  locale: string;
  /**
   * Address rendering template. Tokens are replaced with the corresponding
   * address field; a line containing no resolved tokens is dropped entirely.
   */
  addressFormat: string;
  /** What this country calls its first-level subdivision. */
  regionLabel: string;
  /** What this country calls a city or town. */
  localityLabel: string;
  postalCodeLabel: string;
  /** Whether a postal code is customarily part of an address here. */
  usesPostalCode: boolean;
  /** Property type keys renamed for this market. */
  propertyTypeLabels?: Partial<Record<PropertyTypeKey, string>>;
  /**
   * Extended review categories that are commonly relevant here. These are
   * *offered* to reviewers in this market — they are never scored unless
   * residents actually rate them.
   */
  suggestedCategories: string[];
}

const GLOBAL_SUGGESTED = ['internet', 'cleanliness', 'parking', 'natural_light'];

export const MARKETS: Record<CountryCode, MarketConfig> = {
  US: {
    code: 'US',
    name: 'United States',
    defaultCurrency: 'USD',
    locale: 'en-US',
    addressFormat: '{buildingName}\n{streetAddress}\n{locality}, {adminArea} {postalCode}',
    regionLabel: 'State',
    localityLabel: 'City',
    postalCodeLabel: 'ZIP code',
    usesPostalCode: true,
    propertyTypeLabels: { apartment: 'Apartment', shared: 'Shared apartment' },
    suggestedCategories: [...GLOBAL_SUGGESTED, 'heating_cooling', 'pests', 'laundry'],
  },
  GB: {
    code: 'GB',
    name: 'United Kingdom',
    defaultCurrency: 'GBP',
    locale: 'en-GB',
    addressFormat: '{buildingName}\n{streetAddress}\n{locality}\n{postalCode}',
    regionLabel: 'County',
    localityLabel: 'Town or city',
    postalCodeLabel: 'Postcode',
    usesPostalCode: true,
    propertyTypeLabels: {
      apartment: 'Flat',
      shared: 'Houseshare',
      townhouse: 'Terraced house',
      duplex: 'Maisonette',
    },
    suggestedCategories: [...GLOBAL_SUGGESTED, 'heating_cooling', 'damp_mould', 'pests'],
  },
  NG: {
    code: 'NG',
    name: 'Nigeria',
    defaultCurrency: 'NGN',
    locale: 'en-NG',
    addressFormat: '{buildingName}\n{streetAddress}\n{neighbourhood}\n{locality}, {adminArea}',
    regionLabel: 'State',
    localityLabel: 'City',
    postalCodeLabel: 'Postal code',
    usesPostalCode: false,
    propertyTypeLabels: { apartment: 'Apartment', shared: 'Shared apartment' },
    suggestedCategories: [
      ...GLOBAL_SUGGESTED,
      'water_supply',
      'power_reliability',
      'drainage',
      'pests',
    ],
  },
  CA: {
    code: 'CA',
    name: 'Canada',
    defaultCurrency: 'CAD',
    locale: 'en-CA',
    addressFormat: '{buildingName}\n{streetAddress}\n{locality}, {adminArea} {postalCode}',
    regionLabel: 'Province',
    localityLabel: 'City',
    postalCodeLabel: 'Postal code',
    usesPostalCode: true,
    propertyTypeLabels: { apartment: 'Apartment', duplex: 'Condo' },
    suggestedCategories: [...GLOBAL_SUGGESTED, 'heating_cooling', 'laundry'],
  },
  AU: {
    code: 'AU',
    name: 'Australia',
    defaultCurrency: 'AUD',
    locale: 'en-AU',
    addressFormat: '{buildingName}\n{streetAddress}\n{locality} {adminArea} {postalCode}',
    regionLabel: 'State',
    localityLabel: 'Suburb',
    postalCodeLabel: 'Postcode',
    usesPostalCode: true,
    propertyTypeLabels: { apartment: 'Apartment', shared: 'Sharehouse' },
    suggestedCategories: [...GLOBAL_SUGGESTED, 'heating_cooling', 'damp_mould'],
  },
  IE: {
    code: 'IE',
    name: 'Ireland',
    defaultCurrency: 'EUR',
    locale: 'en-IE',
    addressFormat: '{buildingName}\n{streetAddress}\n{locality}\n{adminArea}\n{postalCode}',
    regionLabel: 'County',
    localityLabel: 'Town or city',
    postalCodeLabel: 'Eircode',
    usesPostalCode: true,
    propertyTypeLabels: { apartment: 'Apartment', shared: 'Houseshare' },
    suggestedCategories: [...GLOBAL_SUGGESTED, 'heating_cooling', 'damp_mould'],
  },
  DE: {
    code: 'DE',
    name: 'Germany',
    defaultCurrency: 'EUR',
    locale: 'de-DE',
    addressFormat: '{buildingName}\n{streetAddress}\n{postalCode} {locality}',
    regionLabel: 'State',
    localityLabel: 'City',
    postalCodeLabel: 'Postal code',
    usesPostalCode: true,
    propertyTypeLabels: { apartment: 'Apartment', shared: 'Shared flat' },
    suggestedCategories: [...GLOBAL_SUGGESTED, 'heating_cooling', 'damp_mould'],
  },
  NL: {
    code: 'NL',
    name: 'Netherlands',
    defaultCurrency: 'EUR',
    locale: 'nl-NL',
    addressFormat: '{buildingName}\n{streetAddress}\n{postalCode} {locality}',
    regionLabel: 'Province',
    localityLabel: 'City',
    postalCodeLabel: 'Postcode',
    usesPostalCode: true,
    propertyTypeLabels: { apartment: 'Apartment', shared: 'Shared house' },
    suggestedCategories: [...GLOBAL_SUGGESTED, 'heating_cooling', 'damp_mould', 'bike_storage'],
  },
  FR: {
    code: 'FR',
    name: 'France',
    defaultCurrency: 'EUR',
    locale: 'fr-FR',
    addressFormat: '{buildingName}\n{streetAddress}\n{postalCode} {locality}',
    regionLabel: 'Region',
    localityLabel: 'City',
    postalCodeLabel: 'Postal code',
    usesPostalCode: true,
    propertyTypeLabels: { apartment: 'Apartment', studio: 'Studio' },
    suggestedCategories: [...GLOBAL_SUGGESTED, 'heating_cooling', 'damp_mould'],
  },
  ZA: {
    code: 'ZA',
    name: 'South Africa',
    defaultCurrency: 'ZAR',
    locale: 'en-ZA',
    addressFormat: '{buildingName}\n{streetAddress}\n{neighbourhood}\n{locality}\n{postalCode}',
    regionLabel: 'Province',
    localityLabel: 'City',
    postalCodeLabel: 'Postal code',
    usesPostalCode: true,
    propertyTypeLabels: { apartment: 'Apartment', shared: 'Shared house' },
    suggestedCategories: [...GLOBAL_SUGGESTED, 'water_supply', 'power_reliability', 'pests'],
  },
  AE: {
    code: 'AE',
    name: 'United Arab Emirates',
    defaultCurrency: 'AED',
    locale: 'en-AE',
    addressFormat: '{buildingName}\n{streetAddress}\n{neighbourhood}\n{locality}',
    regionLabel: 'Emirate',
    localityLabel: 'City',
    postalCodeLabel: 'PO Box',
    usesPostalCode: false,
    propertyTypeLabels: { apartment: 'Apartment', shared: 'Shared apartment' },
    suggestedCategories: [...GLOBAL_SUGGESTED, 'heating_cooling', 'water_supply'],
  },
  IN: {
    code: 'IN',
    name: 'India',
    defaultCurrency: 'INR',
    locale: 'en-IN',
    addressFormat: '{buildingName}\n{streetAddress}\n{neighbourhood}\n{locality}, {adminArea} {postalCode}',
    regionLabel: 'State',
    localityLabel: 'City',
    postalCodeLabel: 'PIN code',
    usesPostalCode: true,
    propertyTypeLabels: { apartment: 'Flat', shared: 'Shared flat' },
    suggestedCategories: [
      ...GLOBAL_SUGGESTED,
      'water_supply',
      'power_reliability',
      'drainage',
      'pests',
    ],
  },
};

/** A stable, alphabetical list for country pickers. */
export const MARKET_LIST: MarketConfig[] = Object.values(MARKETS).sort((a, b) =>
  a.name.localeCompare(b.name),
);

/**
 * Falls back to a neutral configuration rather than to any one country, so an
 * unrecognised code never silently renders as a US address.
 */
export const NEUTRAL_MARKET: MarketConfig = {
  code: 'ZZ',
  name: 'Other',
  defaultCurrency: 'USD',
  locale: 'en',
  addressFormat: '{buildingName}\n{streetAddress}\n{neighbourhood}\n{locality}\n{adminArea} {postalCode}',
  regionLabel: 'Region',
  localityLabel: 'City',
  postalCodeLabel: 'Postal code',
  usesPostalCode: true,
  suggestedCategories: GLOBAL_SUGGESTED,
};

export function getMarket(countryCode: CountryCode | null | undefined): MarketConfig {
  if (!countryCode) return NEUTRAL_MARKET;
  return MARKETS[countryCode.toUpperCase()] ?? NEUTRAL_MARKET;
}

/** Base labels, overridden per market where the local word differs. */
const BASE_PROPERTY_TYPE_LABELS: Record<PropertyTypeKey, string> = {
  apartment: 'Apartment',
  house: 'House',
  townhouse: 'Townhouse',
  duplex: 'Duplex',
  studio: 'Studio',
  shared: 'Shared home',
  room: 'Room',
  bungalow: 'Bungalow',
  building: 'Building',
};

export function propertyTypeLabel(
  type: PropertyTypeKey,
  countryCode: CountryCode | null | undefined,
): string {
  const market = getMarket(countryCode);
  return market.propertyTypeLabels?.[type] ?? BASE_PROPERTY_TYPE_LABELS[type];
}

export const PROPERTY_TYPE_KEYS: PropertyTypeKey[] = [
  'apartment',
  'house',
  'townhouse',
  'duplex',
  'studio',
  'shared',
  'room',
  'bungalow',
  'building',
];
