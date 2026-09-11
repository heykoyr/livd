import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { cn } from '@/lib/utils';

/**
 * Directory filters.
 *
 * A plain GET form, deliberately. Every filtered view is a URL a moderator can
 * bookmark, paste into a case note or open in a second tab — which is how this
 * kind of tool is actually used, and none of it works if the state lives in
 * React. It also means the whole surface functions before any JavaScript
 * arrives.
 *
 * The search box accepts an account id or an email address. Which one it is
 * decides who may run it, and the database is what decides: confirming that an
 * address holds an account here is a disclosure, and not a moderator's to make.
 * A moderator who tries is told so plainly rather than shown an empty result,
 * because a silent nothing teaches the wrong lesson about what the system did.
 */

export interface DirectoryQuery {
  search: string;
  role: string;
  status: string;
  verified: string;
  reported: string;
}

export function DirectoryFilters({
  query,
  canSearchByEmail,
  resultCount,
}: {
  query: DirectoryQuery;
  canSearchByEmail: boolean;
  resultCount: number;
}) {
  const isFiltered =
    Boolean(query.search) ||
    Boolean(query.role) ||
    Boolean(query.status) ||
    Boolean(query.verified) ||
    Boolean(query.reported);

  return (
    <form
      method="get"
      action="/admin/users"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
            Search
          </span>
          <Input
            name="q"
            type="search"
            defaultValue={query.search}
            placeholder={
              canSearchByEmail ? 'Account id or email address' : 'Account id (first characters)'
            }
           
          />
          <span className="text-micro text-ink-subtle">
            {canSearchByEmail
              ? 'An id matches by prefix. An address must match exactly, and the search is recorded.'
              : 'An id matches by prefix. Searching by email address needs Trust & Safety authorisation.'}
          </span>
        </label>

        <FilterSelect name="role" label="Role" value={query.role}>
          <option value="">Any role</option>
          <option value="resident">Resident</option>
          <option value="owner">Owner</option>
          <option value="moderator">Moderator</option>
          <option value="trust_admin">Trust &amp; Safety</option>
          <option value="admin">Administrator</option>
        </FilterSelect>

        <FilterSelect name="status" label="Standing" value={query.status}>
          <option value="">Any standing</option>
          <option value="active">Active</option>
          <option value="restricted">Restricted</option>
          <option value="suspended">Suspended</option>
        </FilterSelect>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <FilterSelect name="verified" label="Verification" value={query.verified}>
          <option value="">Any</option>
          <option value="yes">Has verified reviews</option>
          <option value="no">No verified reviews</option>
        </FilterSelect>

        <FilterSelect name="reported" label="Reports" value={query.reported}>
          <option value="">Any</option>
          <option value="yes">Has been reported</option>
          <option value="no">Never reported</option>
        </FilterSelect>

        <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
          <p aria-live="polite" className="text-label text-ink-muted">
            <span className="tabular font-medium text-ink">{resultCount}</span>{' '}
            {resultCount === 1 ? 'account' : 'accounts'}
            {isFiltered && ' match'}
          </p>

          {isFiltered && (
            <Link
              href="/admin/users"
              className="text-label text-ink-muted underline underline-offset-4 hover:text-ink"
            >
              Clear
            </Link>
          )}

          <Button type="submit" variant="secondary">
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
  className,
}: {
  name: string;
  label: string;
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('flex flex-col gap-1.5 md:w-48', className)}>
      <span className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
        {label}
      </span>
      <Select name={name} defaultValue={value}>
        {children}
      </Select>
    </label>
  );
}
