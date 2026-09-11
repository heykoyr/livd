import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Pagination } from '@/components/ui/pagination';
import { Badge, EmptyState } from '@/components/ui/primitives';
import { formatRelativeTime, propertyDisplayName } from '@/lib/format';
import { caseCategories, listCases } from '@/server/admin';
import { getCurrentUser } from '@/server/auth/session';
import type { CasePriority, CaseStatus } from '@/types/domain';
import {
  CASE_PRIORITY_LABELS,
  CASE_PRIORITY_TONES,
  CASE_STATUS_LABELS,
  CASE_STATUS_TONES,
} from './labels';

/**
 * Cases.
 *
 * The queue this console is actually organised around. A report is now an
 * input to a case rather than a thing to be dealt with on its own, which is
 * what makes "three reports about the same review" a single decision instead
 * of three.
 *
 * Ordered by priority and then by age, so the top of the list is genuinely the
 * next thing to pick up. Defaults to open cases only — a queue that shows
 * everything ever closed is a queue nobody scrolls.
 */

export const dynamic = 'force-dynamic';

function first(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const requestedPage = Number(first(params.page) || '1');
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1;

  const query = {
    status: first(params.status),
    priority: first(params.priority),
    category: first(params.category),
    reference: first(params.q),
    mine: first(params.mine) === '1',
    unassigned: first(params.unassigned) === '1',
    // Closed cases are excluded unless somebody asks for them.
    all: first(params.all) === '1',
  };

  const [viewer, categories] = await Promise.all([getCurrentUser(), caseCategories()]);

  const cases = await listCases({
    page,
    pageSize: 25,
    status: (query.status || null) as CaseStatus | null,
    priority: (query.priority || null) as CasePriority | null,
    category: query.category || null,
    assignedTo: query.mine ? (viewer?.id ?? null) : null,
    unassignedOnly: query.unassigned,
    openOnly: !query.all && !query.status,
    reference: query.reference || null,
  });

  const keepQuery = (next: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({
      status: query.status,
      priority: query.priority,
      category: query.category,
      q: query.reference,
      mine: query.mine ? '1' : '',
      unassigned: query.unassigned ? '1' : '',
      all: query.all ? '1' : '',
    })) {
      if (value) search.set(key, value);
    }
    search.set('page', String(next));
    return `/admin/cases?${search.toString()}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-display text-title-lg tracking-tightish text-ink">Cases</h2>
        <p className="mt-1 max-w-prose text-label text-ink-muted">
          One investigation per case, however many reports it gathers. Opening a case does nothing
          to the review it concerns — hiding or removing anything is a separate decision, with its
          own reason.
        </p>
      </div>

      <form
        method="get"
        action="/admin/cases"
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
              Reference
            </span>
            <Input name="q" type="search" defaultValue={query.reference} placeholder="LV-1048" />
          </label>

          <label className="flex flex-col gap-1.5 md:w-48">
            <span className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
              Status
            </span>
            <Select name="status" defaultValue={query.status}>
              <option value="">Open cases</option>
              {(Object.keys(CASE_STATUS_LABELS) as CaseStatus[]).map((status) => (
                <option key={status} value={status}>
                  {CASE_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-1.5 md:w-40">
            <span className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
              Priority
            </span>
            <Select name="priority" defaultValue={query.priority}>
              <option value="">Any</option>
              {(Object.keys(CASE_PRIORITY_LABELS) as CasePriority[]).map((priority) => (
                <option key={priority} value={priority}>
                  {CASE_PRIORITY_LABELS[priority]}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-1.5 md:w-52">
            <span className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
              Category
            </span>
            <Select name="category" defaultValue={query.category}>
              <option value="">Any</option>
              {categories.map((category) => (
                <option key={category.key} value={category.key}>
                  {category.label}
                </option>
              ))}
            </Select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="flex items-center gap-2 text-label text-ink-muted">
            <input type="checkbox" name="mine" value="1" defaultChecked={query.mine} className="size-4" />
            Assigned to me
          </label>
          <label className="flex items-center gap-2 text-label text-ink-muted">
            <input
              type="checkbox"
              name="unassigned"
              value="1"
              defaultChecked={query.unassigned}
              className="size-4"
            />
            Unassigned
          </label>
          <label className="flex items-center gap-2 text-label text-ink-muted">
            <input type="checkbox" name="all" value="1" defaultChecked={query.all} className="size-4" />
            Include concluded
          </label>

          <div className="ml-auto flex items-center gap-3">
            <p aria-live="polite" className="text-label text-ink-muted">
              <span className="tabular font-medium text-ink">{cases.total}</span>{' '}
              {cases.total === 1 ? 'case' : 'cases'}
            </p>
            <Button type="submit" variant="secondary">
              Apply
            </Button>
          </div>
        </div>
      </form>

      {cases.items.length === 0 ? (
        <EmptyState
          title="No cases"
          description="Cases are opened from a report, or directly from a review under investigation. Nothing is opened automatically."
        />
      ) : (
        <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
          {cases.items.map((entry) => (
            <li key={entry.id} className="bg-surface p-4 hover:bg-surface-sunken/40">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/cases/${entry.id}`}
                      className="font-mono text-label font-medium text-ink underline-offset-4 hover:underline"
                    >
                      {entry.reference}
                    </Link>
                    <Badge tone={CASE_PRIORITY_TONES[entry.priority]}>
                      {CASE_PRIORITY_LABELS[entry.priority]}
                    </Badge>
                    <Badge tone={CASE_STATUS_TONES[entry.status]}>
                      {CASE_STATUS_LABELS[entry.status]}
                    </Badge>
                    {entry.preservationHold && <Badge tone="brand">Preserved</Badge>}
                  </div>

                  <p className="mt-2 text-body text-ink">{entry.summary}</p>

                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-ink-subtle">
                    {entry.property && <span>{propertyDisplayName(entry.property.address)}</span>}
                    <span>
                      {entry.reportCount} report{entry.reportCount === 1 ? '' : 's'}
                    </span>
                    <span>
                      {entry.noteCount} note{entry.noteCount === 1 ? '' : 's'}
                    </span>
                    {entry.assignedTo ? (
                      <span className="font-mono">
                        assigned {entry.assignedTo.slice(0, 8)}
                        {entry.assignedTo === viewer?.id && ' · you'}
                      </span>
                    ) : (
                      <span className="text-caution">Unassigned</span>
                    )}
                  </p>
                </div>

                <p className="shrink-0 text-micro text-ink-subtle">
                  Opened {formatRelativeTime(entry.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={cases.page}
        pageSize={cases.pageSize}
        total={cases.total}
        buildHref={keepQuery}
      />
    </div>
  );
}
