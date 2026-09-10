import Link from 'next/link';

import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { Pagination } from '@/components/ui/pagination';
import { copy } from '@/content/copy';
import { formatRelativeTime } from '@/lib/format';
import { readAuditActors, readAuditSummary, readAuditTrail } from '@/server/admin';
import { hasRole } from '@/server/auth/guards';
import { getCurrentUser } from '@/server/auth/session';
import { ROLE_LABELS } from '../users/labels';
import { TrailFilters } from './filters';
import {
  IDENTITY_ACTIONS,
  OUTCOME_LABELS,
  OUTCOME_TONES,
  SOURCE_LABELS,
  SUBJECT_LABELS,
  actionLabel,
  subjectHref,
} from './labels';

/**
 * The audit trail.
 *
 * Livd keeps two records and they are not the same thing:
 *
 *   decisions   what was done to content and accounts, with the previous and
 *               new state of the thing decided
 *   access      who touched a person's information — including the reads, and
 *               including the attempts that were refused
 *
 * They stay separate in the database, because two rows for one act can
 * disagree and then a reader has to decide which is lying. They are joined
 * here, at the point of reading, which is the only place a union costs
 * nothing.
 *
 * OPENING THIS PAGE IS RECORDED
 *
 * `livd_admin_audit_feed` writes its `audit_log_read` entry in the same
 * statement block that answers the query, so there is no ordering of events in
 * which somebody pages through the trail and nothing notes it.
 *
 * That is not suspicion of colleagues. This is the one place in Livd that
 * lists, in order, every account whose identity has been looked at — and a log
 * that exempts its own readers has a hole exactly where the most curious
 * person would look. The page says so rather than doing it quietly.
 */

export const dynamic = 'force-dynamic';

export const metadata = {
  title: `Audit trail — ${copy.admin.title}`,
  robots: { index: false, follow: false, nocache: true },
};

const PAGE_SIZE = 50;

function first(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

/** A relative window as an absolute instant, resolved once per request. */
function windowStart(choice: string): string | null {
  const days: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };
  const span = days[choice];
  if (!span) return null;

  return new Date(Date.now() - span * 24 * 60 * 60 * 1000).toISOString();
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await getCurrentUser();

  if (!hasRole(viewer, 'trust_admin')) {
    return (
      <EmptyState
        title="Not available"
        description="The audit trail is read by Trust & Safety. A moderator appears in it, which is most of the point of it — the history of the work they are entitled to see is on the case they did it under."
      />
    );
  }

  const params = await searchParams;

  const requestedPage = Number(first(params.page) || '1');
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1;

  const query = {
    source: first(params.source),
    action: first(params.action),
    actor: first(params.actor),
    outcome: first(params.outcome),
    subject: first(params.subject).trim(),
    since: first(params.since),
    reads: first(params.reads),
  };

  const since = windowStart(query.since);

  // The feed records that it was read. The two summaries deliberately do not:
  // they run on this same page load, and three entries for one visit would say
  // something false about how many times the trail was opened.
  const [result, actions, actors] = await Promise.all([
    readAuditTrail({
      page,
      pageSize: PAGE_SIZE,
      source: query.source === 'audit' || query.source === 'moderation' ? query.source : null,
      action: query.action || null,
      actorId: query.actor || null,
      outcome:
        query.outcome === 'succeeded' || query.outcome === 'denied' || query.outcome === 'failed'
          ? query.outcome
          : null,
      subjectId: query.subject || null,
      since,
      includeReads: query.reads === 'yes',
    }),
    readAuditSummary(since),
    readAuditActors(since),
  ]);

  const readCount = actions.find((entry) => entry.action === 'audit_log_read')?.entries ?? 0;
  const denials = actions.reduce((total, entry) => total + entry.denials, 0);

  const buildHref = (next: number) => {
    const search = new URLSearchParams();
    if (query.source) search.set('source', query.source);
    if (query.action) search.set('action', query.action);
    if (query.actor) search.set('actor', query.actor);
    if (query.outcome) search.set('outcome', query.outcome);
    if (query.subject) search.set('subject', query.subject);
    if (query.since) search.set('since', query.since);
    if (query.reads === 'yes') search.set('reads', 'yes');
    if (next > 1) search.set('page', String(next));

    const qs = search.toString();
    return qs ? `/admin/audit?${qs}` : '/admin/audit';
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-title-lg tracking-tightish text-ink">Audit trail</h2>
        <p className="mt-1 max-w-prose text-label text-ink-muted">
          Two records, read as one: what was decided about content and accounts, and who touched a
          person&rsquo;s information. Refused attempts are here too — somebody trying and being
          stopped is worth knowing about.
        </p>
      </div>

      <Card className="border-caution/30 bg-caution-soft/30 p-4">
        <p className="max-w-prose text-label text-ink">
          <span className="font-semibold">Opening this page is recorded.</span> The entry is written
          in the same transaction as the query that answers it, so a read cannot happen without
          one. This is the only place that lists, in order, every account whose identity has been
          looked at; a trail that exempted its own readers would have a hole exactly where the most
          curious person would look.
        </p>
      </Card>

      {/* ---- What has been happening ------------------------------------ */}

      {actions.length > 0 && (
        <section aria-labelledby="summary-heading">
          <h3
            id="summary-heading"
            className="text-micro font-semibold uppercase tracking-micro text-ink-subtle"
          >
            {since ? 'In this window' : 'All time'}
          </h3>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Figure label="Entries" value={actions.reduce((t, e) => t + e.entries, 0)} />
            <Figure label="People" value={actors.length} />
            <Figure
              label="Refused attempts"
              value={denials}
              note={denials > 0 ? 'Worth a look' : 'None'}
            />
            <Figure
              label="Identity crossings"
              value={actions
                .filter((entry) => IDENTITY_ACTIONS.has(entry.action))
                .reduce((total, entry) => total + entry.entries, 0)}
            />
          </div>
        </section>
      )}

      <TrailFilters
        query={query}
        actions={actions}
        actors={actors}
        resultCount={result.total}
      />

      {query.reads !== 'yes' && readCount > 0 && (
        <p className="text-micro text-ink-subtle">
          <span className="tabular">{readCount}</span>{' '}
          {readCount === 1 ? 'entry records' : 'entries record'} this page being opened, hidden so
          they do not drown the rest. Tick the box above to include them — they are filtered, never
          removed.
        </p>
      )}

      {/* ---- The trail --------------------------------------------------- */}

      {result.items.length === 0 ? (
        <EmptyState
          headingLevel="h3"
          title="Nothing matches"
          description="No entry in either record matches these filters. Clearing them shows everything."
        />
      ) : (
        <ol className="flex flex-col gap-2.5">
          {result.items.map((entry) => {
            const href = subjectHref(entry.subjectType, entry.subjectId);
            const crossesIdentity = IDENTITY_ACTIONS.has(entry.action);

            return (
              <li key={entry.id}>
                <Card
                  className={
                    crossesIdentity
                      ? 'border-l-2 border-l-caution p-4'
                      : 'p-4'
                  }
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-body font-medium text-ink">
                          {actionLabel(entry.action)}
                        </span>

                        {entry.outcome !== 'succeeded' && (
                          <Badge tone={OUTCOME_TONES[entry.outcome]}>
                            {OUTCOME_LABELS[entry.outcome]}
                          </Badge>
                        )}

                        <Badge>{SOURCE_LABELS[entry.source]}</Badge>
                      </div>

                      <p className="mt-1.5 text-label text-ink-muted">
                        <span className="font-mono text-ink">
                          {entry.actorEmailMasked ?? entry.actorId?.slice(0, 8) ?? 'account deleted'}
                        </span>
                        {entry.actorRole && (
                          <span> · {ROLE_LABELS[entry.actorRole]} at the time</span>
                        )}
                      </p>
                    </div>

                    <p className="shrink-0 text-micro text-ink-subtle">
                      {formatRelativeTime(entry.createdAt)}
                    </p>
                  </div>

                  {entry.reason && (
                    <p className="prose-measure mt-2.5 whitespace-pre-line text-label text-ink">
                      {entry.reason}
                    </p>
                  )}

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-micro text-ink-subtle">
                    <span>
                      {SUBJECT_LABELS[entry.subjectType] ?? entry.subjectType}
                      {entry.subjectId && (
                        <>
                          {' '}
                          {href ? (
                            <Link
                              href={href}
                              className="font-mono text-ink underline underline-offset-4"
                            >
                              {entry.subjectId.slice(0, 8)}
                            </Link>
                          ) : (
                            <span className="font-mono">{entry.subjectId.slice(0, 8)}</span>
                          )}
                        </>
                      )}
                    </span>

                    {entry.rawAction !== entry.action && (
                      <span className="font-mono">{entry.rawAction}</span>
                    )}

                    <Detail detail={entry.detail} />
                  </div>
                </Card>
              </li>
            );
          })}
        </ol>
      )}

      <Pagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        buildHref={buildHref}
      />

      <p className="max-w-prose text-micro text-ink-subtle">
        Neither record can be edited or deleted — a trigger refuses it, including for the service
        role and the table owner, so there is no path through which an administrator could remove
        the row describing what they read. Entries carry the names of what was touched and never
        the values: an audit log holding the address it recorded access to would be a second copy
        of the thing it exists to protect.
      </p>
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <Card className="p-4">
      <p className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">{label}</p>
      <p className="tabular mt-1 font-display text-title-md text-ink">{value}</p>
      {note && <p className="text-micro text-ink-subtle">{note}</p>}
    </Card>
  );
}

/**
 * The structured context, as words.
 *
 * Field names only, which is the invariant this whole area rests on: the trail
 * records that a thing was touched, never what the thing said.
 */
function Detail({ detail }: { detail: Record<string, unknown> }) {
  const parts = Object.entries(detail)
    .filter(([, value]) => value !== null && value !== undefined && value !== false && value !== '')
    .map(([key, value]) => `${key.replace(/([A-Z])/g, ' $1').toLowerCase()} ${String(value)}`);

  if (parts.length === 0) return null;

  return <span className="min-w-0 truncate">{parts.join(' · ')}</span>;
}
