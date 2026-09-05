import type { ReactNode } from 'react';

/**
 * The shared shell for editorial pages — how it works, trust, legal.
 *
 * Deliberately narrow. These pages are read rather than scanned, and a
 * 68-character measure is the difference between a policy someone finishes and
 * one they abandon.
 */
export function ProsePage({
  eyebrow,
  title,
  lead,
  updated,
  children,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  updated?: string;
  children: ReactNode;
}) {
  return (
    <div className="container-shell py-12 md:py-20">
      <article className="mx-auto w-full max-w-[44rem]">
        <header>
          {eyebrow && (
            <p className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
              {eyebrow}
            </p>
          )}
          <h1 className="mt-4 font-display text-display-lg tracking-display text-ink">{title}</h1>
          {lead && <p className="mt-5 text-body-lg text-ink-muted">{lead}</p>}
          {updated && <p className="mt-4 text-label text-ink-subtle">Last updated {updated}</p>}
        </header>

        <div className="mt-12 flex flex-col gap-10">{children}</div>
      </article>
    </div>
  );
}

export function ProseSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-title-lg tracking-tightish text-ink">{title}</h2>
      <div className="mt-4 flex flex-col gap-4 text-body-lg leading-relaxed text-ink-muted">
        {children}
      </div>
    </section>
  );
}

export function ProseList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-border-strong"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
