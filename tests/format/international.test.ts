import { describe, expect, it } from 'vitest';

import { propertyTypeLabel, getMarket, MARKET_LIST } from '@/config/markets';
import { suggestedExtendedCategories, CORE_CATEGORIES } from '@/config/categories';
import {
  formatAddressInline,
  formatAddressLines,
  formatMoney,
  formatTenure,
  monthsBetween,
  propertyContextLine,
  propertyDisplayName,
  toMonthStart,
} from '@/lib/format';
import type { PropertyAddress } from '@/types/domain';

/**
 * The international layer.
 *
 * Livd claims to be globally native rather than one market with others bolted
 * on. That claim lives almost entirely in this code, so these tests check it
 * concretely: does a UK address render as a UK address, does a Lagos property
 * get asked about water supply and never about central heating, does a rent in
 * naira format as naira.
 */

const address = (overrides: Partial<PropertyAddress>): PropertyAddress => ({
  buildingName: null,
  streetAddress: null,
  neighbourhood: null,
  locality: 'Somewhere',
  adminArea: null,
  postalCode: null,
  countryCode: 'US',
  ...overrides,
});

describe('address rendering', () => {
  it('renders a US address in US order', () => {
    const lines = formatAddressLines(
      address({
        streetAddress: '218 Franklin Avenue',
        locality: 'Brooklyn',
        adminArea: 'NY',
        postalCode: '11205',
        countryCode: 'US',
      }),
    );

    expect(lines).toEqual(['218 Franklin Avenue', 'Brooklyn, NY 11205']);
  });

  it('renders a UK address in UK order, with the postcode on its own line', () => {
    const lines = formatAddressLines(
      address({
        buildingName: 'Meridian Court',
        streetAddress: '14 Morning Lane',
        locality: 'London',
        postalCode: 'E9 6ND',
        countryCode: 'GB',
      }),
    );

    expect(lines).toEqual(['Meridian Court', '14 Morning Lane', 'London', 'E9 6ND']);
  });

  it('puts the postal code before the city in Germany', () => {
    const lines = formatAddressLines(
      address({
        streetAddress: 'Weserstraße 142',
        locality: 'Berlin',
        postalCode: '12045',
        countryCode: 'DE',
      }),
    );

    expect(lines).toEqual(['Weserstraße 142', '12045 Berlin']);
  });

  it('includes the neighbourhood in Nigeria and omits an absent postal code', () => {
    const lines = formatAddressLines(
      address({
        streetAddress: '8 Admiralty Way',
        neighbourhood: 'Lekki Phase 1',
        locality: 'Lagos',
        adminArea: 'Lagos State',
        countryCode: 'NG',
      }),
    );

    expect(lines).toEqual(['8 Admiralty Way', 'Lekki Phase 1', 'Lagos, Lagos State']);
  });

  it('drops empty lines rather than leaving stray punctuation', () => {
    const inline = formatAddressInline(
      address({ streetAddress: '5 Some Road', locality: 'Sydney', countryCode: 'AU' }),
    );

    expect(inline).not.toMatch(/,\s*,/);
    expect(inline).not.toMatch(/^[,\s]/);
    expect(inline).not.toMatch(/[,\s]$/);
    expect(inline).toBe('5 Some Road, Sydney');
  });

  it('never renders an empty address, whatever is missing', () => {
    for (const market of MARKET_LIST) {
      const lines = formatAddressLines(
        address({ locality: 'Testville', countryCode: market.code }),
      );
      expect(lines.join('').length, market.code).toBeGreaterThan(0);
    }
  });

  it('falls back to a neutral format rather than to any one country', () => {
    const lines = formatAddressLines(
      address({ streetAddress: '1 Test Street', locality: 'Nowhere', countryCode: 'XX' }),
    );
    expect(lines).toContain('Nowhere');
    expect(getMarket('XX').name).toBe('Other');
  });
});

describe('property naming', () => {
  it('prefers the building name and puts the street in the context line', () => {
    const withBoth = address({
      buildingName: 'Cutler Works',
      streetAddress: '3 Blossom Street',
      neighbourhood: 'Ancoats',
      locality: 'Manchester',
      countryCode: 'GB',
    });

    expect(propertyDisplayName(withBoth)).toBe('Cutler Works');
    expect(propertyContextLine(withBoth)).toBe('3 Blossom Street, Ancoats, Manchester');
  });

  it('uses the street when there is no building name', () => {
    expect(
      propertyDisplayName(address({ streetAddress: '52 Wells Road', locality: 'Bristol' })),
    ).toBe('52 Wells Road');
  });

  it('does not repeat a component that appears twice', () => {
    // A neighbourhood sharing its city's name would otherwise read
    // "Luxembourg, Luxembourg".
    const line = propertyContextLine(
      address({ neighbourhood: 'Lagos', locality: 'Lagos', adminArea: 'Lagos State' }),
    );
    expect(line).toBe('Lagos, Lagos State');
  });
});

describe('property type labels', () => {
  it('uses the local word for the same underlying type', () => {
    expect(propertyTypeLabel('apartment', 'US')).toBe('Apartment');
    expect(propertyTypeLabel('apartment', 'GB')).toBe('Flat');
    expect(propertyTypeLabel('apartment', 'IN')).toBe('Flat');
    expect(propertyTypeLabel('shared', 'AU')).toBe('Sharehouse');
    expect(propertyTypeLabel('shared', 'GB')).toBe('Houseshare');
  });

  it('falls back to a base label for an unmapped market', () => {
    expect(propertyTypeLabel('apartment', 'XX')).toBe('Apartment');
    expect(propertyTypeLabel('bungalow', 'GB')).toBe('Bungalow');
  });
});

describe('review categories by market', () => {
  it('asks the core set everywhere', () => {
    expect(CORE_CATEGORIES.length).toBeGreaterThanOrEqual(8);
    for (const category of CORE_CATEGORIES) {
      expect(category.appliesToCountries, category.key).toBeNull();
    }
  });

  it('offers water and power in Lagos, and never central heating', () => {
    const keys = suggestedExtendedCategories('NG').map((c) => c.key);

    expect(keys).toContain('water_supply');
    expect(keys).toContain('power_reliability');
    expect(keys).toContain('drainage');
    expect(keys).not.toContain('heating_cooling');
    expect(keys).not.toContain('damp_mould');
  });

  it('offers heating and damp in Manchester, and never generator reliability', () => {
    const keys = suggestedExtendedCategories('GB').map((c) => c.key);

    expect(keys).toContain('heating_cooling');
    expect(keys).toContain('damp_mould');
    expect(keys).not.toContain('water_supply');
    expect(keys).not.toContain('power_reliability');
  });

  it('offers only the globally relevant extras for an unknown market', () => {
    const keys = suggestedExtendedCategories('XX').map((c) => c.key);
    expect(keys).toContain('internet');
    expect(keys).not.toContain('water_supply');
    expect(keys).not.toContain('heating_cooling');
  });
});

describe('money', () => {
  it('formats each currency in its own right, not a global default', () => {
    expect(formatMoney({ amountMinor: 210_000, currencyCode: 'GBP' }, { countryCode: 'GB' })).toContain('£');
    expect(formatMoney({ amountMinor: 289_000, currencyCode: 'USD' }, { countryCode: 'US' })).toContain('$');
    expect(formatMoney({ amountMinor: 98_000, currencyCode: 'EUR' }, { countryCode: 'DE' })).toContain('€');
    expect(formatMoney({ amountMinor: 45_000_000, currencyCode: 'NGN' }, { countryCode: 'NG' })).toContain('₦');
  });

  it('renders two currencies side by side without cross-contamination', () => {
    // Two properties on one comparison page may legitimately differ.
    const pounds = formatMoney({ amountMinor: 210_000, currencyCode: 'GBP' });
    const naira = formatMoney({ amountMinor: 45_000_000, currencyCode: 'NGN' });
    expect(pounds).not.toEqual(naira);
    expect(pounds).toContain('£');
    expect(naira).toContain('₦');
  });

  it('keeps a fraction digit when compacting, so 1,050,000 is not "1M"', () => {
    const formatted = formatMoney({ amountMinor: 105_000_000, currencyCode: 'NGN' }, { compact: true });
    expect(formatted).toMatch(/1\.1M/);
    // The precision the reader actually cares about survives.
    expect(formatted).not.toMatch(/(?<![\d.])1M/);
  });

  it('can append the ISO code where currencies appear together', () => {
    const withCode = formatMoney({ amountMinor: 245_000, currencyCode: 'CAD' }, { withCode: true });
    expect(withCode).toContain('CAD');
    // A bare "$" is ambiguous between USD, CAD and AUD.
    expect(withCode).toMatch(/\$/);
  });

  it('does not compact below a million', () => {
    expect(formatMoney({ amountMinor: 210_000, currencyCode: 'GBP' }, { compact: true })).toBe('£2,100');
  });

  it('degrades rather than throwing on an unknown currency', () => {
    const formatted = formatMoney({ amountMinor: 100_00, currencyCode: 'ZZZ' });
    expect(formatted).toContain('ZZZ');
  });

  it('respects a currency with no minor unit', () => {
    // 5,000 yen is 5000 minor units, not 50.
    expect(formatMoney({ amountMinor: 5_000, currencyCode: 'JPY' })).toContain('5,000');
  });
});

describe('tenure and dates', () => {
  it('reads naturally at each scale', () => {
    expect(formatTenure(1)).toBe('1 month');
    expect(formatTenure(8)).toBe('8 months');
    expect(formatTenure(12)).toBe('1 year');
    expect(formatTenure(24)).toBe('2 years');
    expect(formatTenure(15)).toBe('1 year 3 months');
  });

  it('counts whole months between two tenancy dates', () => {
    expect(monthsBetween('2022-03-01', '2025-06-01')).toBe(39);
    // Moving in and out in the same month is one month, not zero.
    expect(monthsBetween('2024-01-01', '2024-01-01')).toBe(1);
  });

  it('pins any date to the first of its month', () => {
    // Day precision would let a tenancy be matched to a letting record.
    expect(toMonthStart('2024-07-19')).toBe('2024-07-01');
    expect(toMonthStart('2024-07-01')).toBe('2024-07-01');
  });
});

describe('market configuration', () => {
  it('gives every market its own labels rather than anglophone defaults', () => {
    expect(getMarket('GB').regionLabel).toBe('County');
    expect(getMarket('CA').regionLabel).toBe('Province');
    expect(getMarket('US').regionLabel).toBe('State');
    expect(getMarket('AE').regionLabel).toBe('Emirate');
    expect(getMarket('AU').localityLabel).toBe('Suburb');
    expect(getMarket('GB').postalCodeLabel).toBe('Postcode');
    expect(getMarket('IE').postalCodeLabel).toBe('Eircode');
    expect(getMarket('IN').postalCodeLabel).toBe('PIN code');
  });

  it('knows where a postal code is not customary', () => {
    expect(getMarket('NG').usesPostalCode).toBe(false);
    expect(getMarket('AE').usesPostalCode).toBe(false);
    expect(getMarket('GB').usesPostalCode).toBe(true);
  });

  it('has no market defaulting to another market’s currency', () => {
    for (const market of MARKET_LIST) {
      expect(market.defaultCurrency, market.code).toMatch(/^[A-Z]{3}$/);
    }
    expect(getMarket('NG').defaultCurrency).toBe('NGN');
    expect(getMarket('GB').defaultCurrency).toBe('GBP');
  });
});
