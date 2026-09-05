'use server';

import { propertyContextLine, propertyDisplayName } from '@/lib/format';
import { getRepository } from '@/server/data';

/**
 * Resolves a property slug to the minimum the review wizard needs.
 *
 * The wizard works in slugs because that is what search suggestions carry, but
 * the draft schema stores an id — a slug can change, and a review must stay
 * attached to the property rather than to a URL. This is the seam between the
 * two.
 *
 * Public data only: name, location and market. Nothing here is gated, so it
 * needs no authorisation check.
 */

export interface WizardProperty {
  id: string;
  slug: string;
  name: string;
  context: string;
  countryCode: string;
  isDemo: boolean;
}

export async function resolvePropertyBySlug(slug: string): Promise<WizardProperty | null> {
  if (typeof slug !== 'string' || slug.length === 0 || slug.length > 120) return null;

  const repository = await getRepository();
  const property = await repository.getPropertyBySlug(slug);
  if (!property) return null;

  return {
    id: property.id,
    slug: property.slug,
    name: propertyDisplayName(property.address),
    context: propertyContextLine(property.address),
    countryCode: property.address.countryCode,
    isDemo: property.isDemo,
  };
}
