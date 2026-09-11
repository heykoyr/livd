'use client';

import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select } from '@/components/ui/field';
import { Turnstile } from '@/components/ui/turnstile';
import { MARKET_LIST, PROPERTY_TYPE_KEYS, getMarket, propertyTypeLabel } from '@/config/markets';
import { initialNewPropertyState } from '@/server/actions/action-state';
import { createProperty } from '@/server/actions/reviews';

/**
 * Add a property.
 *
 * The form re-labels itself from the chosen country: "State" becomes "County"
 * in the UK and "Province" in Canada, the postal-code field disappears where
 * one is not customary, and property types use the local word. That is read
 * from market configuration rather than branched on, which is what makes
 * adding a market a data change.
 */
export function NewPropertyForm() {
  const [countryCode, setCountryCode] = useState('');
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(createProperty, initialNewPropertyState);

  const market = getMarket(countryCode || null);

  return (
    <form action={formAction} className="mt-10 flex flex-col gap-6">
      <FormError message={state.error} />

      <Field label="Country" error={state.fieldErrors.countryCode}>
        {(props) => (
          <Select
            {...props}
            name="countryCode"
            value={countryCode}
            onChange={(event) => setCountryCode(event.target.value)}
            required
          >
            <option value="">Choose a country</option>
            {MARKET_LIST.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        label="Building or property name"
        hint="If it has one — for example “Meridian Court”."
        error={state.fieldErrors.buildingName}
        optional
      >
        {(props) => <Input {...props} name="buildingName" maxLength={160} />}
      </Field>

      <Field
        label="Street address"
        hint="Street number and name. Never a unit, flat or apartment number."
        error={state.fieldErrors.streetAddress}
      >
        {(props) => <Input {...props} name="streetAddress" maxLength={200} />}
      </Field>

      <Field
        label="Neighbourhood or area"
        error={state.fieldErrors.neighbourhood}
        optional
      >
        {(props) => <Input {...props} name="neighbourhood" maxLength={120} />}
      </Field>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Field label={market.localityLabel} error={state.fieldErrors.locality}>
          {(props) => <Input {...props} name="locality" maxLength={120} required />}
        </Field>

        <Field label={market.regionLabel} error={state.fieldErrors.adminArea} optional>
          {(props) => <Input {...props} name="adminArea" maxLength={120} />}
        </Field>
      </div>

      {market.usesPostalCode && (
        <Field
          label={market.postalCodeLabel}
          error={state.fieldErrors.postalCode}
          optional
          className="sm:max-w-xs"
        >
          {(props) => <Input {...props} name="postalCode" maxLength={20} />}
        </Field>
      )}

      <Field label="Property type" error={state.fieldErrors.propertyType}>
        {(props) => (
          <Select {...props} name="propertyType" defaultValue="apartment" required>
            {PROPERTY_TYPE_KEYS.map((type) => (
              <option key={type} value={type}>
                {propertyTypeLabel(type, countryCode || null)}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {/* Creating a property calls a paid geocoding API, so this endpoint
          costs money as well as data quality if it is left open. */}
      <input type="hidden" name="captchaToken" value={captchaToken ?? ''} />
      <Turnstile action="property-create" onToken={setCaptchaToken} />

      <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-border pt-6">
        <Button type="submit" size="lg" loading={pending}>
          Add property and continue
        </Button>
        <p className="text-label text-ink-subtle">
          If this property already exists, we will take you to it instead of creating a duplicate.
        </p>
      </div>
    </form>
  );
}
