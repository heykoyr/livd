import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Conditional class names with Tailwind conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * URL-safe slug, unicode-aware.
 *
 * Decomposes accented characters rather than stripping them, so "Königstraße"
 * becomes "konigstrasse" and not "knigstrae".
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[øØ]/g, 'o')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Property slug: locality and street, with a short discriminator so two
 * genuinely different properties on the same street never collide.
 */
export function propertySlug(parts: {
  buildingName?: string | null;
  streetAddress?: string | null;
  locality: string;
  discriminator?: string;
}): string {
  const identity = parts.buildingName ?? parts.streetAddress ?? 'property';
  const base = slugify(`${identity}-${parts.locality}`);
  return parts.discriminator ? `${base}-${parts.discriminator.slice(0, 6)}` : base;
}

/** Cheap non-cryptographic id. Used for local-adapter records only. */
export function shortId(length = 10): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

/** Truncates on a word boundary, so a card never ends mid-word. */
export function truncateWords(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > maxChars * 0.6 ? lastSpace : maxChars).trimEnd()}…`;
}

/** Groups an array by a derived key, preserving insertion order. */
export function groupBy<T, K extends string | number>(
  items: T[],
  keyOf: (item: T) => K,
): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/** Reads a positive integer from a URL search param, with a fallback. */
export function parsePositiveInt(value: string | undefined | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
