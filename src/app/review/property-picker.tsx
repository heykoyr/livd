'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';

import { Spinner } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { copy } from '@/content/copy';
import { cn } from '@/lib/utils';
import { resolvePropertyBySlug, type WizardProperty } from '@/server/actions/property-lookup';
import type { SearchSuggestion } from '@/types/domain';

/**
 * Property picker for the review wizard.
 *
 * Deliberately not the site's search combobox: that one navigates, this one
 * selects. Reusing it would have meant a component that sometimes routes and
 * sometimes returns a value, which is the kind of dual-purpose control that
 * quietly breaks keyboard behaviour.
 */
export function PropertyPicker({
  selected,
  onSelect,
}: {
  selected: WizardProperty | null;
  onSelect: (property: WizardProperty | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, startResolving] = useTransition();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(`/api/suggest?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as { suggestions: SearchSuggestion[] };
        // Only properties can be reviewed; a neighbourhood cannot.
        setSuggestions(data.suggestions.filter((s) => s.kind === 'property'));
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);

    return () => window.clearTimeout(timer);
  }, [query]);

  function choose(href: string): void {
    const slug = href.replace('/property/', '');
    startResolving(async () => {
      const property = await resolvePropertyBySlug(slug);
      if (property) onSelect(property);
    });
  }

  if (selected) {
    return (
      <Card className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
            Reviewing
          </p>
          <p className="mt-1.5 font-display text-title-md tracking-tightish text-ink">
            {selected.name}
          </p>
          <p className="mt-0.5 text-label text-ink-muted">{selected.context}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            onSelect(null);
            setQuery('');
          }}
          className="shrink-0 rounded-sm text-label font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
        >
          Change
        </button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-2">
        <span className="text-label font-medium text-ink">{copy.search.placeholder}</span>
        <span
          className={cn(
            'flex h-12 items-center gap-2 rounded-lg border border-border-strong bg-surface px-3.5',
            'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand',
          )}
        >
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            placeholder="Start typing the address or building name"
            className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-subtle"
          />
          {(loading || resolving) && <Spinner className="size-4 text-ink-subtle" />}
        </span>
      </label>

      {suggestions.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {suggestions.map((suggestion) => (
            <li key={suggestion.href}>
              <button
                type="button"
                onClick={() => choose(suggestion.href)}
                className="flex w-full flex-col items-start rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors duration-fast hover:border-border-strong hover:bg-surface-sunken/60"
              >
                <span className="text-body font-medium text-ink">{suggestion.label}</span>
                <span className="text-label text-ink-muted">
                  {suggestion.sublabel}
                  {suggestion.reviewCount !== null && (
                    <> · {copy.property.reviewCount(suggestion.reviewCount)}</>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {query.trim().length >= 2 && !loading && suggestions.length === 0 && (
        <p className="rounded-lg border border-dashed border-border-strong p-5 text-body text-ink-muted">
          No property matches that yet.{' '}
          <Link
            href="/review/new-property"
            className="font-medium text-brand underline underline-offset-4"
          >
            Add it to Livd
          </Link>{' '}
          and you can review it straight away.
        </p>
      )}

      <p className="text-label text-ink-subtle">
        Cannot find it?{' '}
        <Link
          href="/review/new-property"
          className="font-medium text-brand underline underline-offset-4"
        >
          Add the property
        </Link>
        .
      </p>
    </div>
  );
}
