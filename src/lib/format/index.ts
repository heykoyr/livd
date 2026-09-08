/**
 * Formatting.
 *
 * Everything numeric, monetary, temporal or geographic passes through here.
 * There is no hard-coded currency symbol, date pattern or thousands separator
 * anywhere else in the codebase — which is what allows a new market to be a
 * configuration change rather than a rewrite.
 */

import { getMarket } from '@/config/markets';
import type { CountryCode, Money, PropertyAddress, RentPeriod } from '@/types/domain';

/* -------------------------------------------------------------------------
 * Address
 * ---------------------------------------------------------------------- */

/**
 * Renders an address using the country's own template.
 *
 * Lines whose tokens all resolve to nothing are dropped, so a property with no
 * postal code does not produce a trailing blank line or a stray comma.
 */
export function formatAddressLines(address: PropertyAddress): string[] {
  const market = getMarket(address.countryCode);

  const values: Record<string, string | null> = {
    buildingName: address.buildingName,
    streetAddress: address.streetAddress,
    neighbourhood: address.neighbourhood,
    locality: address.locality,
    adminArea: address.adminArea,
    postalCode: address.postalCode,
  };

  return market.addressFormat
    .split('\n')
    .map((line) => {
      let anyResolved = false;
      const rendered = line.replace(/\{(\w+)\}/g, (_match, token: string) => {
        const value = values[token];
        if (value) {
          anyResolved = true;
          return value;
        }
        return '';
      });
      return anyResolved ? tidyAddressLine(rendered) : '';
    })
    .filter((line) => line.length > 0);
}

/** Cleans up the punctuation left behind when a token resolves to nothing. */
function tidyAddressLine(line: string): string {
  return line
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/^[\s,]+/, '')
    .replace(/[\s,]+$/, '')
    .trim();
}

/** A single-line address for cards, meta descriptions and page titles. */
export function formatAddressInline(address: PropertyAddress): string {
  return formatAddressLines(address).join(', ');
}

/**
 * The shortest string that still identifies the property to a human — used as
 * the display name in headings, cards and search results.
 */
export function propertyDisplayName(address: PropertyAddress): string {
  if (address.buildingName && address.streetAddress) {
    return address.buildingName;
  }
  return address.buildingName ?? address.streetAddress ?? address.locality;
}

/** The line that sits beneath the display name. */
export function propertyContextLine(address: PropertyAddress): string {
  const parts = [
    address.buildingName && address.streetAddress ? address.streetAddress : null,
    address.neighbourhood,
    address.locality,
    address.adminArea,
  ].filter((p): p is string => Boolean(p));

  // Drop a repeated component (a neighbourhood that shares its city's name).
  return parts.filter((p, i) => parts.indexOf(p) === i).join(', ');
}

/* -------------------------------------------------------------------------
 * Money
 * ---------------------------------------------------------------------- */

function localeFor(countryCode?: CountryCode | null): string {
  return countryCode ? getMarket(countryCode).locale : 'en';
}

/**
 * Formats a Money value in its own currency.
 *
 * Note the currency comes from the value, never from a global setting — two
 * properties on the same page may legitimately be priced in different
 * currencies and both must render correctly.
 */
export function formatMoney(
  money: Money,
  options: {
    countryCode?: CountryCode | null;
    compact?: boolean;
    /**
     * Appends the ISO code — "$2,450 CAD".
     *
     * For anywhere several currencies appear together, such as the shortlist
     * comparison. A bare "$" is genuinely ambiguous between USD, CAD and AUD,
     * and Livd shows properties from different markets on one page.
     */
    withCode?: boolean;
  } = {},
): string {
  const minorUnit = minorUnitFor(money.currencyCode);
  const amount = money.amountMinor / 10 ** minorUnit;

  // Compact notation only above a million, and with one fraction digit when it
  // engages — "1M" for a rent of 1,050,000 loses the part the reader cares about.
  const useCompact = options.compact === true && amount >= 1_000_000;

  try {
    const formatted = new Intl.NumberFormat(localeFor(options.countryCode), {
      style: 'currency',
      currency: money.currencyCode,
      // Without this, a naira amount reads as "NGN 450,000" in a neutral locale
      // rather than "₦450,000" — Intl only reaches for the symbol when the
      // locale already expects it, which a global product cannot rely on.
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: useCompact ? 1 : options.compact || amount % 1 === 0 ? 0 : minorUnit,
      notation: useCompact ? 'compact' : 'standard',
    }).format(amount);

    return options.withCode ? `${formatted} ${money.currencyCode}` : formatted;
  } catch {
    // An unrecognised currency code should degrade, not throw.
    return `${money.currencyCode} ${new Intl.NumberFormat().format(Math.round(amount))}`;
  }
}

/** Currencies whose minor unit is not 2. */
const MINOR_UNIT_OVERRIDES: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  XAF: 0,
  XOF: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
};

export function minorUnitFor(currencyCode: string): number {
  return MINOR_UNIT_OVERRIDES[currencyCode.toUpperCase()] ?? 2;
}

export function formatRent(
  money: Money,
  period: RentPeriod,
  countryCode?: CountryCode | null,
): string {
  const value = formatMoney(money, { countryCode, compact: true });
  return period === 'month' ? `${value}/month` : `${value}/year`;
}

/* -------------------------------------------------------------------------
 * Numbers
 * ---------------------------------------------------------------------- */

export function formatNumber(value: number, countryCode?: CountryCode | null): string {
  return new Intl.NumberFormat(localeFor(countryCode)).format(value);
}

/** `share` is 0–1. */
export function formatPercent(
  share: number,
  countryCode?: CountryCode | null,
  fractionDigits = 0,
): string {
  return new Intl.NumberFormat(localeFor(countryCode), {
    style: 'percent',
    maximumFractionDigits: fractionDigits,
  }).format(share);
}

/* -------------------------------------------------------------------------
 * Distance
 * ---------------------------------------------------------------------- */

/**
 * Markets that measure short distances in feet and miles rather than metres.
 *
 * A short list rather than a rule, because there is no rule: the United States,
 * the United Kingdom and a handful of others are genuinely mixed, and guessing
 * from the locale would put miles in front of a reader in Berlin. Everywhere
 * not named here gets metric, which is the honest default for most of the
 * world and the one the internals use anyway.
 *
 * The UK is here on purpose: road distances are in miles and people describe
 * walks the same way, whatever the shop scales say.
 */
const IMPERIAL_DISTANCE_MARKETS = new Set(['US', 'GB', 'LR', 'MM']);

/**
 * A walking distance, in the units the reader expects.
 *
 * Metres in, always — every geospatial calculation in Livd is metric, and this
 * is the single point where that becomes a local unit. Deliberately coarse:
 * "400m" rather than "412m", because the input has already been rounded in the
 * data layer and a precise-looking figure would imply a precision the position
 * behind it never had.
 */
export function formatDistance(meters: number, countryCode?: CountryCode | null): string {
  const locale = localeFor(countryCode);
  const imperial = countryCode
    ? IMPERIAL_DISTANCE_MARKETS.has(countryCode.toUpperCase())
    : false;

  if (imperial) {
    const feet = meters * 3.28084;
    if (feet < 1000) {
      return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
        Math.round(feet / 50) * 50,
      )} ft`;
    }
    const miles = meters / 1609.344;
    return `${new Intl.NumberFormat(locale, {
      maximumFractionDigits: miles < 10 ? 1 : 0,
    }).format(miles)} mi`;
  }

  if (meters < 1000) {
    return `${new Intl.NumberFormat(locale).format(Math.round(meters / 10) * 10)} m`;
  }

  const km = meters / 1000;
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: km < 10 ? 1 : 0,
  }).format(km)} km`;
}

/* -------------------------------------------------------------------------
 * Dates and durations
 * ---------------------------------------------------------------------- */

/** "March 2024" — month precision is the finest Livd ever displays. */
export function formatMonthYear(isoDate: string, countryCode?: CountryCode | null): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(localeFor(countryCode), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function formatYear(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return String(date.getUTCFullYear());
}

/**
 * "3 months ago", "2 years ago".
 *
 * Deliberately coarse. A review timestamped to the day, on a page about where
 * someone lives, is more precision than the reader needs and more than the
 * writer should have to expose.
 */
export function formatRelativeTime(isoDate: string, countryCode?: CountryCode | null): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';

  const rtf = new Intl.RelativeTimeFormat(localeFor(countryCode), { numeric: 'auto' });
  const diffMs = date.getTime() - Date.now();
  const diffDays = Math.round(diffMs / 86_400_000);

  if (Math.abs(diffDays) < 30) return rtf.format(diffDays, 'day');

  const diffMonths = Math.round(diffDays / 30.44);
  if (Math.abs(diffMonths) < 12) return rtf.format(diffMonths, 'month');

  return rtf.format(Math.round(diffMonths / 12), 'year');
}

/** "2 years", "8 months", "1 year 3 months". */
export function formatTenure(months: number): string {
  if (months < 1) return 'less than a month';
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'}`;

  const years = Math.floor(months / 12);
  const remainder = months % 12;
  const yearPart = `${years} ${years === 1 ? 'year' : 'years'}`;

  if (remainder === 0) return yearPart;
  return `${yearPart} ${remainder} ${remainder === 1 ? 'month' : 'months'}`;
}

/**
 * Whole months between two month-pinned dates.
 * Both ends count, so moving in and out in the same month is one month.
 */
export function monthsBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;

  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth());
  return Math.max(1, months);
}

/** Normalises any date to the first of its month, which is all Livd stores. */
export function toMonthStart(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  return monthStart.toISOString().slice(0, 10);
}
