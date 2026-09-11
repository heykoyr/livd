'use client';

import { useEffect, useState } from 'react';

import {
  CheckboxChipGroup,
  RadioCardGroup,
  RatingLegend,
  RatingScale,
} from '@/components/ui/choice';
import { Field, CharacterCount, Input, Select, Textarea } from '@/components/ui/field';
import { Badge, Card } from '@/components/ui/primitives';
import {
  CORE_CATEGORIES,
  EXTENDED_CATEGORIES,
  suggestedExtendedCategories,
} from '@/config/categories';
import { DEPARTURE_REASONS_SORTED } from '@/config/departure-reasons';
import { MARKET_LIST, getMarket } from '@/config/markets';
import { POSITIVE_TAGS, PROBLEM_TAGS } from '@/config/tags';
import { LIMITS } from '@/config/site';
import { copy } from '@/content/copy';
import { cn } from '@/lib/utils';
import type { WizardDraft } from './wizard-types';
import { VerifyLocation } from '@/components/property/verify-location';
import { PropertyPicker } from './property-picker';

/**
 * The wizard's individual steps.
 *
 * One decision per screen. A single long form produces abandonment and vague
 * prose; a sequence of specific questions produces the structured, comparable
 * data the intelligence layer actually needs.
 */

export interface StepProps {
  draft: WizardDraft;
  update: (patch: Partial<WizardDraft>) => void;
  error: string | null;
}

/* -------------------------------------------------------------------------
 * 1. Property
 * ---------------------------------------------------------------------- */

export function PropertyStep({ draft, update }: StepProps) {
  return (
    <PropertyPicker
      selected={draft.property}
      onSelect={(property) => update({ property })}
    />
  );
}

/* -------------------------------------------------------------------------
 * 2. Verify (offered only where the property has a location to check against)
 * ---------------------------------------------------------------------- */

export function VerifyStep({ draft, update }: StepProps) {
  if (!draft.property) return <p className="text-body text-ink-muted">Choose a property first.</p>;

  return (
    <VerifyLocation
      propertyId={draft.property.id}
      propertyName={draft.property.name}
      verified={draft.verificationId !== null}
      onVerified={(verificationId) => update({ verificationId })}
    />
  );
}

/* -------------------------------------------------------------------------
 * 3. Residency
 * ---------------------------------------------------------------------- */

export function ResidencyStep({ draft, update, error }: StepProps) {
  return (
    <RadioCardGroup
      name="residency"
      legend={copy.review.steps.residency.title}
      hideLegend
      value={draft.residencyStatus}
      onChange={(value) =>
        update({
          residencyStatus: value as 'current' | 'former',
          // Switching to "current" must clear the answers that only make sense
          // for someone who has left, or they would be submitted invisibly.
          ...(value === 'current'
            ? { movedOutMonth: null, primaryDepartureReason: null, secondaryDepartureReasons: [] }
            : {}),
        })
      }
      error={error}
      options={[
        {
          value: 'current',
          label: copy.review.steps.residency.current,
          description: copy.review.steps.residency.currentHint,
        },
        {
          value: 'former',
          label: copy.review.steps.residency.former,
          description: copy.review.steps.residency.formerHint,
        },
      ]}
    />
  );
}

/* -------------------------------------------------------------------------
 * 3. Dates
 * ---------------------------------------------------------------------- */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function DatesStep({ draft, update, error }: StepProps) {
  const currentYear = new Date().getUTCFullYear();
  const years = Array.from({ length: 41 }, (_, i) => currentYear - i);

  return (
    <div className="flex flex-col gap-8">
      <MonthYearField
        legend={copy.review.steps.dates.movedIn}
        value={draft.movedInMonth}
        years={years}
        onChange={(value) => update({ movedInMonth: value })}
      />

      {draft.residencyStatus === 'former' && (
        <MonthYearField
          legend={copy.review.steps.dates.movedOut}
          value={draft.movedOutMonth}
          years={years}
          onChange={(value) => update({ movedOutMonth: value })}
        />
      )}

      {error && (
        <p role="alert" className="text-label text-critical">
          {error}
        </p>
      )}

      <p className="text-label text-ink-subtle">
        Livd stores the month, never the day. Your tenancy cannot be matched against a specific
        letting record.
      </p>
    </div>
  );
}

/**
 * A month-and-year pair.
 *
 * Holds its own half-entered state. Deriving both selects from the committed
 * ISO date meant the first selection was discarded on re-render — a date is
 * only valid once both halves exist, so choosing a month while the year was
 * still empty committed null and reset the select the user had just used. The
 * field was impossible to complete, and the wizard impossible to finish.
 */
function MonthYearField({
  legend,
  value,
  years,
  onChange,
}: {
  legend: string;
  value: string | null;
  years: number[];
  onChange: (value: string | null) => void;
}) {
  const [month, setMonth] = useState(() => (value ? value.slice(5, 7) : ''));
  const [year, setYear] = useState(() => (value ? value.slice(0, 4) : ''));

  // A committed value arriving from elsewhere (a restored draft) wins.
  useEffect(() => {
    if (!value) return;
    setMonth(value.slice(5, 7));
    setYear(value.slice(0, 4));
  }, [value]);

  function commit(nextMonth: string, nextYear: string): void {
    setMonth(nextMonth);
    setYear(nextYear);
    onChange(nextMonth && nextYear ? `${nextYear}-${nextMonth}-01` : null);
  }

  return (
    <fieldset>
      <legend className="text-body font-medium text-ink">{legend}</legend>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-md">
        <label className="flex flex-col gap-1.5">
          <span className="text-label text-ink-muted">{copy.review.steps.dates.month}</span>
          <Select value={month} onChange={(event) => commit(event.target.value, year)}>
            <option value="">—</option>
            {MONTHS.map((name, index) => (
              <option key={name} value={String(index + 1).padStart(2, '0')}>
                {name}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-label text-ink-muted">{copy.review.steps.dates.year}</span>
          <Select value={year} onChange={(event) => commit(month, event.target.value)}>
            <option value="">—</option>
            {years.map((option) => (
              <option key={option} value={String(option)}>
                {option}
              </option>
            ))}
          </Select>
        </label>
      </div>
    </fieldset>
  );
}

/* -------------------------------------------------------------------------
 * 4. Overall
 * ---------------------------------------------------------------------- */

export function OverallStep({ draft, update, error }: StepProps) {
  return (
    <div>
      <RatingScale
        name="overall"
        legend="Your overall experience"
        value={draft.overallRating}
        onChange={(value) => update({ overallRating: value })}
      />
      {error && (
        <p role="alert" className="mt-3 text-label text-critical">
          {error}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * 5. Categories
 * ---------------------------------------------------------------------- */

export function CategoriesStep({ draft, update, error }: StepProps) {
  const countryCode = draft.property?.countryCode ?? null;
  const suggested = suggestedExtendedCategories(countryCode);
  const [showAll, setShowAll] = useState(false);

  // Core everywhere; the market's suggested extras up front; the rest behind a
  // disclosure. Nothing is unreachable, but nobody in London is asked about
  // generator reliability by default.
  const suggestedKeys = new Set(suggested.map((c) => c.key));
  const extra = EXTENDED_CATEGORIES.filter((c) => !suggestedKeys.has(c.key));
  const visible = [...CORE_CATEGORIES, ...suggested, ...(showAll ? extra : [])];

  function rate(key: string, rating: number): void {
    update({
      categoryRatings: { ...draft.categoryRatings, [key]: rating },
      skippedCategories: draft.skippedCategories.filter((k) => k !== key),
    });
  }

  function skip(key: string): void {
    const next = { ...draft.categoryRatings };
    delete next[key];
    update({
      categoryRatings: next,
      skippedCategories: [...new Set([...draft.skippedCategories, key])],
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="text-label text-critical">
          {error}
        </p>
      )}

      {/*
        The compact scale has no room for a word under each number, so this is
        where the meaning of 1 and 5 lives. Sticky, because the list is longer
        than a phone screen and guidance that scrolls away is guidance that is
        missing at the moment it is needed. The step before this one carries
        the same information under its buttons, so nothing is repeated on one
        screen — it simply never stops being available.
      */}
      <RatingLegend />

      <ul className="flex flex-col gap-6">
        {visible.map((category) => {
          const skipped = draft.skippedCategories.includes(category.key);
          return (
            <li
              key={category.key}
              className={cn(
                'rounded-lg border p-4 transition-colors duration-fast',
                skipped ? 'border-dashed border-border opacity-60' : 'border-border',
              )}
            >
              <RatingScale
                name={`category-${category.key}`}
                legend={category.label}
                description={category.prompt}
                value={draft.categoryRatings[category.key] ?? null}
                onChange={(rating) => rate(category.key, rating)}
                onSkip={() => skip(category.key)}
                skipLabel={copy.review.steps.categories.notApplicable}
                size="sm"
              />
            </li>
          );
        })}
      </ul>

      {!showAll && extra.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="self-start rounded-md text-label font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
        >
          {copy.review.steps.categories.addMore}
        </button>
      )}

      <Card className="p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={draft.noticedManagementChange === true}
            onChange={(event) =>
              update({ noticedManagementChange: event.target.checked ? true : false })
            }
            className="mt-0.5 size-4 accent-brand"
          />
          <span>
            <span className="block text-body font-medium text-ink">
              The landlord or managing agent changed while I lived there
            </span>
            <span className="mt-0.5 block text-label text-ink-muted">
              This is the only way Livd can put a change of management on a property&rsquo;s
              timeline without inferring one.
            </span>
          </span>
        </label>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * 6 & 7. Tags
 * ---------------------------------------------------------------------- */

export function PositivesStep({ draft, update }: StepProps) {
  return (
    <CheckboxChipGroup
      name="positives"
      legend={copy.review.steps.positives.title}
      hideLegend
      options={POSITIVE_TAGS.map((tag) => ({ value: tag.key, label: tag.label }))}
      values={draft.positiveTags}
      onChange={(values) => update({ positiveTags: values })}
      tone="positive"
      max={8}
    />
  );
}

export function ProblemsStep({ draft, update }: StepProps) {
  return (
    <CheckboxChipGroup
      name="problems"
      legend={copy.review.steps.problems.title}
      hideLegend
      options={PROBLEM_TAGS.map((tag) => ({ value: tag.key, label: tag.label }))}
      values={draft.problemTags}
      onChange={(values) => update({ problemTags: values })}
      tone="problem"
      max={8}
    />
  );
}

/* -------------------------------------------------------------------------
 * 8. Departure
 * ---------------------------------------------------------------------- */

export function DepartureStep({ draft, update, error }: StepProps) {
  const options = DEPARTURE_REASONS_SORTED.map((reason) => ({
    value: reason.key,
    label: reason.label,
  }));

  return (
    <div className="flex flex-col gap-8">
      <RadioCardGroup
        name="departure-primary"
        legend={copy.review.steps.departure.primary}
        options={options}
        value={draft.primaryDepartureReason}
        onChange={(value) =>
          update({
            primaryDepartureReason: value,
            // The primary reason must not also be a secondary one, or it would
            // be double-counted in the departure analysis.
            secondaryDepartureReasons: draft.secondaryDepartureReasons.filter((k) => k !== value),
          })
        }
        columns={2}
        error={error}
      />

      <CheckboxChipGroup
        name="departure-secondary"
        legend={copy.review.steps.departure.secondary}
        hint={copy.review.steps.departure.secondaryOptional}
        options={options.filter((option) => option.value !== draft.primaryDepartureReason)}
        values={draft.secondaryDepartureReasons}
        onChange={(values) => update({ secondaryDepartureReasons: values })}
        max={3}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * 9. Words
 * ---------------------------------------------------------------------- */

export function WordsStep({ draft, update, error }: StepProps) {
  const market = getMarket(draft.property?.countryCode);
  const [showPrompts, setShowPrompts] = useState(false);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Field
          label="Your review"
          hint={copy.review.steps.words.lead}
          error={error}
          optional
        >
          {(props) => (
            <Textarea
              {...props}
              value={draft.body}
              onChange={(event) => update({ body: event.target.value })}
              maxLength={LIMITS.reviewBodyMax}
              rows={9}
              placeholder={copy.review.steps.words.placeholder}
            />
          )}
        </Field>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowPrompts((value) => !value)}
            aria-expanded={showPrompts}
            className="rounded-sm text-label text-brand underline underline-offset-4 hover:text-brand-hover"
          >
            {copy.review.steps.words.prompts}
          </button>
          <CharacterCount used={draft.body.length} max={LIMITS.reviewBodyMax} />
        </div>

        {showPrompts && (
          <ul className="mt-3 flex flex-col gap-1.5 rounded-lg border border-border bg-surface-sunken/60 p-4">
            {copy.review.steps.words.promptList.map((prompt) => (
              <li key={prompt} className="text-label text-ink-muted">
                {prompt}
              </li>
            ))}
          </ul>
        )}
      </div>

      <RadioCardGroup
        name="recommend"
        legend={copy.review.steps.words.recommendQuestion}
        value={draft.wouldRecommend === null ? null : draft.wouldRecommend ? 'yes' : 'no'}
        onChange={(value) => update({ wouldRecommend: value === 'yes' })}
        columns={2}
        options={[
          { value: 'yes', label: copy.review.steps.words.recommendYes },
          { value: 'no', label: copy.review.steps.words.recommendNo },
        ]}
      />

      <fieldset>
        <legend className="text-label font-medium text-ink">
          {copy.review.steps.words.rentQuestion}
        </legend>
        <p className="mt-1 text-label text-ink-muted">{copy.review.steps.words.rentHint}</p>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:max-w-lg sm:grid-cols-[1fr_auto_auto]">
          <label className="flex flex-col gap-1.5">
            <span className="sr-only">Rent amount</span>
            <Input
              inputMode="decimal"
              value={draft.rentAmount}
              onChange={(event) => update({ rentAmount: event.target.value })}
              placeholder="1,200"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="sr-only">Currency</span>
            <Select
              value={draft.rentCurrency || market.defaultCurrency}
              onChange={(event) => update({ rentCurrency: event.target.value })}
            >
              {[...new Set(MARKET_LIST.map((m) => m.defaultCurrency))].sort().map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="sr-only">Period</span>
            <Select
              value={draft.rentPeriod}
              onChange={(event) =>
                update({ rentPeriod: event.target.value as 'month' | 'year' })
              }
            >
              <option value="month">per month</option>
              <option value="year">per year</option>
            </Select>
          </label>
        </div>
      </fieldset>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * 10. Confirm
 * ---------------------------------------------------------------------- */

export function ConfirmStep({ draft, update, error }: StepProps) {
  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col gap-3">
        {copy.review.steps.confirm.rules.map((rule) => (
          <li key={rule} className="flex items-start gap-3 rounded-lg border border-border p-4">
            <span
              aria-hidden="true"
              className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-ink"
            >
              <svg viewBox="0 0 12 12" className="size-3" fill="none">
                <path
                  d="m2 6.3 2.3 2.3L10 2.9"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="text-body text-ink">{rule}</span>
          </li>
        ))}
      </ul>

      <Card className="p-5">
        <h3 className="text-label font-semibold text-ink">How your review will appear</h3>
        <p className="mt-2 text-body text-ink-muted">
          <Badge tone="neutral">
            {draft.residencyStatus === 'current' ? 'Current resident' : 'Former resident'}
          </Badge>{' '}
          — with how long you lived there. Your name, email and account are never shown, and no
          part of your review links back to you.
        </p>
      </Card>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border-strong p-4">
        <input
          type="checkbox"
          checked={draft.confirmedGuidelines}
          onChange={(event) => update({ confirmedGuidelines: event.target.checked })}
          className="mt-0.5 size-4 accent-brand"
        />
        <span className="text-body font-medium text-ink">{copy.review.steps.confirm.agree}</span>
      </label>

      {error && (
        <p role="alert" className="text-label text-critical">
          {error}
        </p>
      )}
    </div>
  );
}
