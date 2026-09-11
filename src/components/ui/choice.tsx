'use client';

import { useId, useState } from 'react';

import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------
 * Radio cards
 * ---------------------------------------------------------------------- */

export interface ChoiceOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * A radio group rendered as cards.
 *
 * Built on real `<input type="radio">` elements inside a `<fieldset>`, so
 * arrow-key navigation, form submission and screen-reader group semantics all
 * work without a line of JavaScript. The card is styling on top of a native
 * control, not a replacement for one.
 */
export function RadioCardGroup({
  name,
  legend,
  hint,
  options,
  value,
  onChange,
  columns = 1,
  error,
  required,
  hideLegend = false,
}: {
  name: string;
  legend: string;
  hint?: string;
  options: ChoiceOption[];
  value: string | null;
  onChange: (value: string) => void;
  columns?: 1 | 2;
  error?: string | null;
  required?: boolean;
  /**
   * Hides the legend visually while keeping it as the fieldset's accessible
   * name. Used where the step heading already asks the question — a sighted
   * reader should not see it twice, and a screen-reader user still needs the
   * group to be named.
   */
  hideLegend?: boolean;
}) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <fieldset aria-describedby={error ? errorId : undefined}>
      <legend className={hideLegend ? 'sr-only' : 'text-label font-medium text-ink'}>
        {legend}
      </legend>
      {hint && !hideLegend && <p className="mt-1 text-label text-ink-muted">{hint}</p>}

      <div
        className={cn(
          'mt-3 grid gap-2',
          columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1',
        )}
      >
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                'group relative flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3.5',
                'transition-colors duration-fast',
                'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand',
                selected
                  ? 'border-brand bg-brand-soft'
                  : 'border-border bg-surface hover:border-border-strong hover:bg-surface-sunken/50',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                required={required}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border-2',
                  selected ? 'border-brand' : 'border-border-strong',
                )}
              >
                {selected && <span className="size-2 rounded-full bg-brand" />}
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    'block text-body font-medium',
                    selected ? 'text-brand-ink' : 'text-ink',
                  )}
                >
                  {option.label}
                </span>
                {option.description && (
                  <span className="mt-0.5 block text-label text-ink-muted">
                    {option.description}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>

      {error && (
        <p id={errorId} role="alert" className="mt-2 text-label text-critical">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/* -------------------------------------------------------------------------
 * Checkbox chips
 * ---------------------------------------------------------------------- */

/**
 * Multi-select chips over native checkboxes.
 *
 * Used for "what was good" and "what was difficult" — structured data that can
 * be counted across a property's history, which free text cannot.
 */
export function CheckboxChipGroup({
  name,
  legend,
  hint,
  options,
  values,
  onChange,
  tone = 'neutral',
  max,
  hideLegend = false,
}: {
  name: string;
  legend: string;
  hint?: string;
  options: Array<{ value: string; label: string }>;
  values: string[];
  onChange: (values: string[]) => void;
  tone?: 'neutral' | 'positive' | 'problem';
  max?: number;
  /** See `RadioCardGroup` — the step heading already asks the question. */
  hideLegend?: boolean;
}) {
  const selected = new Set(values);
  const atLimit = max !== undefined && values.length >= max;

  function toggle(value: string): void {
    if (selected.has(value)) {
      onChange(values.filter((v) => v !== value));
    } else if (!atLimit) {
      onChange([...values, value]);
    }
  }

  return (
    <fieldset>
      <legend className={hideLegend ? 'sr-only' : 'text-label font-medium text-ink'}>
        {legend}
      </legend>
      {hint && !hideLegend && <p className="mt-1 text-label text-ink-muted">{hint}</p>}

      <div className={cn('flex flex-wrap gap-2', hideLegend ? '' : 'mt-3')}>
        {options.map((option) => {
          const isSelected = selected.has(option.value);
          const disabled = atLimit && !isSelected;

          return (
            <label
              key={option.value}
              className={cn(
                'inline-flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-2 text-label',
                'transition-colors duration-fast',
                'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand',
                isSelected && tone === 'positive' && 'border-positive/40 bg-positive-soft text-positive',
                isSelected && tone === 'problem' && 'border-caution/40 bg-caution-soft text-caution',
                isSelected && tone === 'neutral' && 'border-brand bg-brand-soft text-brand-ink',
                !isSelected && 'border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink',
                disabled && 'cursor-not-allowed opacity-45',
              )}
            >
              <input
                type="checkbox"
                name={name}
                value={option.value}
                checked={isSelected}
                disabled={disabled}
                onChange={() => toggle(option.value)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-4 shrink-0 place-items-center rounded-xs border',
                  isSelected ? 'border-current bg-current/10' : 'border-border-strong',
                )}
              >
                {isSelected && (
                  <svg viewBox="0 0 12 12" className="size-3" fill="none">
                    <path
                      d="m2.5 6.2 2.3 2.3 4.7-5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              {option.label}
            </label>
          );
        })}
      </div>

      {max !== undefined && (
        <p aria-live="polite" className="mt-2 text-micro text-ink-subtle">
          {values.length} of {max} selected
        </p>
      )}
    </fieldset>
  );
}

/* -------------------------------------------------------------------------
 * Rating scale
 * ---------------------------------------------------------------------- */

const RATING_WORDS = ['Poor', 'Weak', 'Mixed', 'Good', 'Excellent'] as const;

/**
 * A 1–5 rating as a radio group.
 *
 * Numbers with words underneath rather than stars: a star average is exactly
 * the impression Livd is trying not to give, and a labelled scale produces more
 * consistent data than five identical icons.
 */
export function RatingScale({
  name,
  legend,
  description,
  value,
  onChange,
  onSkip,
  skipLabel,
  size = 'md',
}: {
  name: string;
  legend: string;
  description?: string;
  value: number | null;
  onChange: (value: number) => void;
  onSkip?: () => void;
  skipLabel?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <fieldset className="min-w-0">
      <legend className={cn('font-medium text-ink', size === 'sm' ? 'text-label' : 'text-body')}>
        {legend}
      </legend>
      {description && <p className="mt-0.5 text-label text-ink-muted">{description}</p>}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {[1, 2, 3, 4, 5].map((rating) => {
          const selected = value === rating;
          return (
            <label
              key={rating}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center rounded-md border',
                'transition-colors duration-fast',
                'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand',
                size === 'sm' ? 'h-11 w-11' : 'h-14 w-14 sm:w-16',
                selected
                  ? 'border-brand bg-brand text-canvas'
                  : 'border-border bg-surface text-ink-muted hover:border-border-strong hover:bg-surface-sunken',
              )}
            >
              <input
                type="radio"
                name={name}
                value={rating}
                checked={selected}
                onChange={() => onChange(rating)}
                className="sr-only"
              />
              <span className="text-body font-semibold tabular">{rating}</span>
              {size === 'md' && (
                <span className="text-[0.625rem] leading-tight">{RATING_WORDS[rating - 1]}</span>
              )}
              <span className="sr-only">{RATING_WORDS[rating - 1]}</span>
            </label>
          );
        })}

        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className={cn(
              'ml-1 rounded-md px-3 text-label text-ink-subtle underline underline-offset-4',
              'transition-colors duration-fast hover:text-ink',
              size === 'sm' ? 'h-11' : 'h-14',
            )}
          >
            {skipLabel ?? 'Did not apply'}
          </button>
        )}
      </div>
    </fieldset>
  );
}

/* -------------------------------------------------------------------------
 * Segmented control
 * ---------------------------------------------------------------------- */

/**
 * A small set of mutually exclusive view options — review filters, sort order.
 * Uses the tab roving-tabindex pattern so arrow keys move between options.
 */
export function SegmentedControl({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: Array<{ value: string; label: string; count?: number }>;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [focusIndex, setFocusIndex] = useState(() =>
    Math.max(0, options.findIndex((o) => o.value === value)),
  );

  function handleKeyDown(event: React.KeyboardEvent): void {
    const last = options.length - 1;
    let next = focusIndex;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = focusIndex >= last ? 0 : focusIndex + 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = focusIndex <= 0 ? last : focusIndex - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else return;

    event.preventDefault();
    setFocusIndex(next);
    const option = options[next];
    if (option) onChange(option.value);
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={cn(
        'inline-flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-surface-sunken p-1',
        className,
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => {
              setFocusIndex(index);
              onChange(option.value);
            }}
            className={cn(
              'shrink-0 rounded-md px-3 py-1.5 text-label font-medium transition-colors duration-fast',
              selected
                ? 'bg-surface text-ink shadow-none ring-1 ring-border'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span className="ml-1.5 tabular text-ink-subtle">{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
