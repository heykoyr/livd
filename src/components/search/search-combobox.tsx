'use client';

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from 'react';

import { Spinner } from '@/components/ui/button';
import { copy } from '@/content/copy';
import { cn } from '@/lib/utils';
import type { SearchSuggestion } from '@/types/domain';

/**
 * The search combobox.
 *
 * Implements the ARIA 1.2 combobox-with-listbox pattern: the input keeps focus
 * throughout, `aria-activedescendant` moves the virtual cursor, and Enter
 * commits either the highlighted suggestion or the raw query. Getting this
 * right matters more here than anywhere else in the product — search is the
 * front door, and a combobox that traps focus or swallows Enter makes the whole
 * site unusable by keyboard.
 *
 * Recent searches are kept in `localStorage` only. They are a convenience for
 * this browser, never a profile: nothing about what a person searched for
 * reaches the server attached to their identity.
 */

const RECENT_KEY = 'livd-recent-searches';
const RECENT_LIMIT = 5;
const DEBOUNCE_MS = 160;

export function SearchCombobox({
  initialQuery = '',
  size = 'md',
  autoFocus = false,
  placeholder,
  className,
}: {
  initialQuery?: string;
  size?: 'md' | 'lg';
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* --- Recent searches --- */

  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_KEY);
      if (stored) setRecent(JSON.parse(stored) as string[]);
    } catch {
      // Storage unavailable. Recent searches are a convenience, not a feature
      // anything depends on.
    }
  }, []);

  const rememberSearch = useCallback((value: string) => {
    const trimmed = value.trim();
    if (trimmed.length < 2) return;

    setRecent((current) => {
      const next = [trimmed, ...current.filter((item) => item !== trimmed)].slice(0, RECENT_LIMIT);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  function clearRecent(): void {
    setRecent([]);
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch {
      /* ignore */
    }
  }

  /* --- Fetching suggestions --- */

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < 2) {
      setSuggestions([]);
      setLoading(false);
      abortRef.current?.abort();
      return;
    }

    setLoading(true);
    const timer = window.setTimeout(async () => {
      // Only the latest request may resolve; an earlier slow response must not
      // overwrite a newer fast one.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(`/api/suggest?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Suggest request failed');
        const data = (await response.json()) as { suggestions: SearchSuggestion[] };
        setSuggestions(data.suggestions);
        setActiveIndex(-1);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [query]);

  /* --- Dismissal --- */

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  /* --- Options --- */

  const showRecent = query.trim().length < 2 && recent.length > 0;
  const options: Array<{ key: string; label: string; sublabel?: string; href?: string; term?: string }> =
    showRecent
      ? recent.map((term) => ({ key: `recent-${term}`, label: term, term }))
      : suggestions.map((suggestion) => ({
          key: `${suggestion.kind}-${suggestion.href}`,
          label: suggestion.label,
          sublabel:
            suggestion.reviewCount !== null
              ? `${suggestion.sublabel} · ${copy.property.reviewCount(suggestion.reviewCount)}`
              : suggestion.sublabel,
          href: suggestion.href,
        }));

  const expanded = open && options.length > 0;

  /* --- Commit --- */

  function commit(index: number): void {
    const option = index >= 0 ? options[index] : undefined;

    if (option?.href) {
      rememberSearch(query);
      setOpen(false);
      startTransition(() => router.push(option.href!));
      return;
    }

    const term = option?.term ?? query;
    if (term.trim().length === 0) return;

    rememberSearch(term);
    setOpen(false);
    startTransition(() => router.push(`/search?q=${encodeURIComponent(term.trim())}`));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!expanded) {
          setOpen(true);
          return;
        }
        setActiveIndex((index) => (index + 1) % options.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!expanded) return;
        setActiveIndex((index) => (index <= 0 ? options.length - 1 : index - 1));
        break;
      case 'Home':
        if (!expanded) return;
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        if (!expanded) return;
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
        event.preventDefault();
        commit(activeIndex);
        break;
      case 'Escape':
        if (expanded) {
          event.preventDefault();
          setOpen(false);
          setActiveIndex(-1);
        }
        break;
      default:
        break;
    }
  }

  const activeId = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          commit(activeIndex);
        }}
      >
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg border bg-surface transition-colors duration-fast',
            'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand',
            expanded ? 'border-brand' : 'border-border-strong hover:border-ink-subtle',
            size === 'lg' ? 'h-14 px-4' : 'h-11 px-3',
          )}
        >
          <SearchIcon className="size-[18px] shrink-0 text-ink-subtle" />

          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={expanded}
            aria-controls={listboxId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label={copy.search.inputLabel}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- only on the dedicated search page, where the search field is the page's purpose
            autoFocus={autoFocus}
            value={query}
            placeholder={placeholder ?? copy.search.placeholder}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            className={cn(
              'min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-subtle',
              size === 'lg' ? 'text-body-lg' : 'text-body',
            )}
          />

          {loading && <Spinner className="size-4 shrink-0 text-ink-subtle" />}

          {query.length > 0 && !loading && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSuggestions([]);
                inputRef.current?.focus();
              }}
              className="grid size-7 shrink-0 place-items-center rounded-full text-ink-subtle transition-colors duration-fast hover:bg-surface-sunken hover:text-ink"
            >
              <span className="sr-only">{copy.search.clear}</span>
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          )}

          <button
            type="submit"
            className={cn(
              'shrink-0 rounded-md bg-brand px-3.5 font-medium text-canvas transition-colors duration-fast hover:bg-brand-hover',
              size === 'lg' ? 'h-10 text-body' : 'h-8 text-label',
            )}
          >
            {copy.search.submit}
          </button>
        </div>
      </form>

      {/* Announces result availability without stealing focus. */}
      <div aria-live="polite" className="sr-only">
        {expanded ? `${options.length} suggestions available.` : ''}
      </div>

      <ul
        id={listboxId}
        role="listbox"
        aria-label={showRecent ? copy.search.recentSearches : copy.search.suggestionsLabel}
        hidden={!expanded}
        className="absolute inset-x-0 top-full z-50 mt-2 max-h-[min(24rem,60dvh)] overflow-y-auto rounded-lg border border-border bg-surface p-1.5 shadow-popover"
      >
        {showRecent && (
          <li className="flex items-center justify-between px-2.5 py-1.5" role="presentation">
            <span className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
              {copy.search.recentSearches}
            </span>
            <button
              type="button"
              onClick={clearRecent}
              className="rounded-sm text-micro text-ink-subtle underline underline-offset-2 hover:text-ink"
            >
              {copy.search.clearRecent}
            </button>
          </li>
        )}

        {options.map((option, index) => (
          <li
            key={option.key}
            id={`${listboxId}-option-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            // Pointer, not click: mousedown would blur the input first.
            onPointerDown={(event) => {
              event.preventDefault();
              commit(index);
            }}
            onPointerEnter={() => setActiveIndex(index)}
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2.5',
              index === activeIndex ? 'bg-brand-soft' : 'hover:bg-surface-sunken',
            )}
          >
            {showRecent ? (
              <HistoryIcon className="size-4 shrink-0 text-ink-subtle" />
            ) : (
              <PinIcon className="size-4 shrink-0 text-ink-subtle" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body text-ink">{option.label}</span>
              {option.sublabel && (
                <span className="block truncate text-label text-ink-muted">{option.sublabel}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" className={className} fill="none" aria-hidden="true">
      <circle cx="7.75" cy="7.75" r="5.25" stroke="currentColor" strokeWidth="1.6" />
      <path d="m11.75 11.75 3.75 3.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path
        d="M8 14.5s5-4.35 5-8a5 5 0 0 0-10 0c0 3.65 5 8 5 8Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="6.4" r="1.7" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path
        d="M2.6 8a5.4 5.4 0 1 0 1.6-3.85"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M2.3 2.6v2.6h2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 5.2V8l1.9 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
