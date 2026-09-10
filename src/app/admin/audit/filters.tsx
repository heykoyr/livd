import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import type { AuditActionSummary, AuditActorSummary } from '@/server/data/repository';
import { ROLE_LABELS } from '../users/labels';
import { actionLabel } from './labels';

/**
 * Trail filters.
 *
 * A plain GET form, like the directory's. Every filtered view is a URL that can
 * be bookmarked, pasted into a case note or opened in a second tab — which is
 * how this tool is actually used, and none of it works if the state lives in
 * React. It also means the whole surface functions before any JavaScript
 * arrives.
 *
 * The action and actor lists are built from what is actually in the trail
 * rather than from the vocabulary, so the dropdown never offers a filter that
 * would return nothing.
 */

export interface TrailQuery {
  source: string;
  action: string;
  actor: string;
  outcome: string;
  subject: string;
  since: string;
  reads: string;
}

export function TrailFilters({
  query,
  actions,
  actors,
  resultCount,
}: {
  query: TrailQuery;
  actions: AuditActionSummary[];
  actors: AuditActorSummary[];
  resultCount: number;
}) {
  const isFiltered =
    Boolean(query.source) ||
    Boolean(query.action) ||
    Boolean(query.actor) ||
    Boolean(query.outcome) ||
    Boolean(query.subject) ||
    Boolean(query.since) ||
    query.reads === 'yes';

  return (
    <form
      method="get"
      action="/admin/audit"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <FilterSelect name="action" label="What happened" value={query.action}>
          <option value="">Anything</option>
          {actions.map((entry) => (
            <option key={entry.action} value={entry.action}>
              {actionLabel(entry.action)} ({entry.entries})
            </option>
          ))}
        </FilterSelect>

        <FilterSelect name="actor" label="Who" value={query.actor}>
          <option value="">Anyone</option>
          {actors.map((actor) => (
            <option key={actor.actorId} value={actor.actorId}>
              {actor.actorEmailMasked ?? actor.actorId.slice(0, 8)}
              {actor.actorRole ? ` — ${ROLE_LABELS[actor.actorRole]}` : ''} ({actor.entries})
            </option>
          ))}
        </FilterSelect>

        <FilterSelect name="source" label="Kind" value={query.source}>
          <option value="">Both trails</option>
          <option value="audit">Access to information</option>
          <option value="moderation">Decisions</option>
        </FilterSelect>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <FilterSelect name="outcome" label="Outcome" value={query.outcome}>
          <option value="">Any</option>
          <option value="succeeded">Done</option>
          <option value="denied">Refused</option>
          <option value="failed">Failed</option>
        </FilterSelect>

        <FilterSelect name="since" label="Since" value={query.since}>
          <option value="">All time</option>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </FilterSelect>

        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
            About
          </span>
          <Input
            name="subject"
            type="search"
            defaultValue={query.subject}
            placeholder="Account, review or case id"
            className="h-10"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <label className="flex items-center gap-2.5 text-label text-ink">
          <input
            type="checkbox"
            name="reads"
            value="yes"
            defaultChecked={query.reads === 'yes'}
            className="size-4"
          />
          Include entries recording that this page was opened
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <p aria-live="polite" className="text-label text-ink-muted">
            <span className="tabular font-medium text-ink">{resultCount}</span>{' '}
            {resultCount === 1 ? 'entry' : 'entries'}
            {isFiltered && ' match'}
          </p>

          {isFiltered && (
            <Link
              href="/admin/audit"
              className="text-label text-ink-muted underline underline-offset-4 hover:text-ink"
            >
              Clear
            </Link>
          )}

          <Button type="submit" variant="secondary" size="sm">
            Apply
          </Button>
        </div>
      </div>
    </form>
  );
}

function FilterSelect({
  name,
  label,
  value,
  children,
}: {
  name: string;
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
        {label}
      </span>
      <Select name={name} defaultValue={value} className="h-10">
        {children}
      </Select>
    </label>
  );
}
