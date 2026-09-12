import type { Metadata } from 'next';
import Link from 'next/link';

import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, Eyebrow, Meter } from '@/components/ui/primitives';
import { ConfidenceChip, ScoreDial, TrendPill } from '@/components/property/score';
import { SITE } from '@/config/site';
import { copy } from '@/content/copy';
import { scoreBand } from '@/lib/intelligence/scoring';

/**
 * Why Livd.
 *
 * The product's argument, and deliberately not an about page. It answers four
 * questions in order — why Livd exists, why the information can be trusted,
 * why a resident writing something matters, and why to read it before
 * committing — and every section ends by handing the reader back to the
 * product rather than to more prose.
 *
 * On the composition: `/how-it-works` and `/trust` use `ProsePage`, a 44rem
 * measure, because those are documents somebody reads start to finish. This
 * page is not that. It argues in statements, and a statement needs room and a
 * rule under it, so it is built from the same full-width editorial sections as
 * the landing page — hairline dividers, tinted bands to separate movements,
 * and type doing the work that a marketing page would give to illustration.
 * No stock photography, no icon grid, no gradients.
 *
 * On the product UI used as proof: the score dial, confidence chip, trend pill
 * and category meters here are the real components from the property page, not
 * drawings of them. What they render is an example, and it is labelled as an
 * example wherever it appears — a page arguing that Livd does not manufacture
 * confidence cannot itself present invented figures as a real property.
 */

const CANONICAL = `${SITE.url}/why-livd`;

export const metadata: Metadata = {
  title: 'Why Livd',
  description:
    'A viewing lasts an hour; a tenancy lasts a year. Livd collects what residents who actually lived at a property say about it, so the next person can decide with more than a viewing.',
  alternates: { canonical: CANONICAL },
  openGraph: {
    type: 'website',
    title: `Why Livd — ${SITE.tagline}`,
    description:
      'You can see the property. You cannot see the year. Livd collects resident experiences so the next person can decide with more than a viewing.',
    url: CANONICAL,
  },
};

export default function WhyLivdPage() {
  return (
    <>
      <Hero />
      <GapSection />
      <ResidentsKnowSection />
      <ContributeSection />
      <BetterQuestionSection />
      <TrustSection />
      <WontDoSection />
      <OwnersSection />
      <HistorySection />
      <GlobalSection />
      <HowSection />
      <LoopSection />
      <CloseSection />
    </>
  );
}

/* -------------------------------------------------------------------------
 * Hero
 * ---------------------------------------------------------------------- */

function Hero() {
  return (
    <section className="border-b border-border bg-surface">
      <div className="container-shell py-20 md:py-28">
        <div className="max-w-3xl">
          <Eyebrow className="animate-fade">{copy.whyLivd.eyebrow}</Eyebrow>

          <h1 className="mt-5 font-display text-display-xl tracking-display text-ink">
            {copy.whyLivd.title}
          </h1>

          <p className="mt-6 max-w-xl text-body-lg text-ink-muted">{copy.whyLivd.lead}</p>

          <div className="mt-9 flex flex-wrap gap-3">
            <ButtonLink href="/search" size="lg">
              {copy.whyLivd.searchCta}
            </ButtonLink>
            <ButtonLink href="/review" variant="secondary" size="lg">
              {copy.whyLivd.contributeCta}
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * An hour against a year
 * ---------------------------------------------------------------------- */

/**
 * The two columns are the argument.
 *
 * A card grid would list features; this sets what an hour can show against
 * what it cannot, in parallel, and lets the asymmetry make the point. The
 * closing line is load-bearing: the gap is an information problem, and saying
 * so is the difference between an honest premise and an accusation about
 * people the page has no evidence about.
 */
function GapSection() {
  return (
    <section className="container-shell py-20 md:py-24">
      <div className="max-w-2xl">
        <h2 className="font-display text-display-md tracking-display text-ink">
          {copy.whyLivd.gapTitle}
        </h2>
        <p className="mt-4 text-body-lg text-ink-muted">{copy.whyLivd.gapLead}</p>
      </div>

      <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2">
        <div className="bg-surface p-7 md:p-8">
          <h3 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
            {copy.whyLivd.gapShowsTitle}
          </h3>
          <ul className="mt-5 flex flex-col gap-3">
            {copy.whyLivd.gapShows.map((item) => (
              <li key={item} className="flex items-start gap-3 text-body text-ink-muted">
                <Marker tone="neutral" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-surface p-7 md:p-8">
          <h3 className="text-micro font-semibold uppercase tracking-micro text-ink">
            {copy.whyLivd.gapCannotTitle}
          </h3>
          <ul className="mt-5 flex flex-col gap-3">
            {copy.whyLivd.gapCannot.map((item) => (
              <li key={item} className="flex items-start gap-3 text-body text-ink">
                <Marker tone="accent" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-8 max-w-prose text-body text-ink-muted">{copy.whyLivd.gapClose}</p>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * What residents know
 * ---------------------------------------------------------------------- */

/**
 * The categories, as the questions behind them.
 *
 * Livd's category list is the product's own taxonomy, and rendering it as a
 * feature grid would waste it. Each row pairs the category name with the
 * question a person actually asks a friend — which is what the category is
 * for, and reads as evidence that the taxonomy came from somewhere real.
 */
function ResidentsKnowSection() {
  return (
    <section className="border-y border-border bg-surface-sunken/50">
      <div className="container-shell py-20 md:py-24">
        <div className="max-w-2xl">
          <h2 className="font-display text-display-md tracking-display text-ink">
            {copy.whyLivd.knowTitle}
          </h2>
          <p className="mt-4 text-body-lg text-ink-muted">{copy.whyLivd.knowLead}</p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-16">
          <div>
            <h3 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
              {copy.whyLivd.knowQuestionsTitle}
            </h3>

            <dl className="mt-5 flex flex-col">
              {copy.whyLivd.knowQuestions.map((entry) => (
                <div
                  key={entry.category}
                  className="flex flex-col gap-1 border-b border-border py-4 sm:flex-row sm:items-baseline sm:gap-6"
                >
                  <dt className="shrink-0 text-label font-medium text-ink sm:w-52">
                    {entry.category}
                  </dt>
                  <dd className="text-body text-ink-muted">{entry.question}</dd>
                </div>
              ))}
            </dl>
          </div>

          <ExampleProperty />
        </div>
      </div>
    </section>
  );
}

/**
 * The real property components, rendering an example.
 *
 * These are the same `ScoreDial`, `ConfidenceChip`, `TrendPill` and `Meter` the
 * property page uses, so the page shows the product rather than a picture of
 * it. Labelled an illustration in the heading, in a badge, and in a caption
 * underneath: this page argues that Livd states the evidence behind every
 * figure, and it would be self-refuting to print numbers here that looked like
 * a real building's.
 */
function ExampleProperty() {
  const categories = [
    { label: 'Neighbours & community', score: 84 },
    { label: 'Safety & security', score: 79 },
    { label: 'Building maintenance', score: 61 },
    { label: 'Value for money', score: 55 },
    { label: 'Noise', score: 42 },
  ];

  return (
    <figure className="lg:sticky lg:top-24 lg:self-start">
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Eyebrow>{copy.whyLivd.knowIllustration}</Eyebrow>
            <p className="mt-2 font-display text-title-md tracking-tightish text-ink">
              How a property reads
            </p>
          </div>
          <Badge tone="accent">{copy.whyLivd.knowIllustration}</Badge>
        </div>

        <div className="mt-6 flex items-center gap-5">
          <ScoreDial score={71} confidence="moderate" size="md" />
          <div className="flex min-w-0 flex-col gap-2">
            <ConfidenceChip confidence="moderate" reviewCount={18} />
            <TrendPill direction="improving" delta={6} />
          </div>
        </div>

        <dl className="mt-6 flex flex-col gap-3.5 border-t border-border pt-5">
          {categories.map((category) => (
            <div key={category.label}>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-label text-ink-muted">{category.label}</dt>
                <dd className="text-label tabular font-medium text-ink">{category.score}</dd>
              </div>
              <Meter
                value={category.score}
                tone={scoreBand(category.score)}
                label={`${category.label} ${category.score} ${copy.score.outOf}`}
                className="mt-1.5"
              />
            </div>
          ))}
        </dl>
      </Card>

      <figcaption className="mt-3 text-micro text-ink-subtle">
        {copy.whyLivd.knowIllustrationNote}
      </figcaption>
    </figure>
  );
}

/* -------------------------------------------------------------------------
 * The four minutes
 * ---------------------------------------------------------------------- */

/**
 * The emotional centre, and the one section allowed to raise its voice.
 *
 * It earns that by being specific rather than sentimental: the claim is that
 * the reader holds particular information, so the page names the information.
 * The list is in the second person and every line is something a person who
 * has rented actually knows. Then the cost — four minutes — and only then the
 * ask.
 *
 * The anonymity line sits directly above the button on purpose. It is the
 * objection everybody has at exactly this moment, and answering it a section
 * later is answering it too late.
 */
function ContributeSection() {
  return (
    <section className="border-b border-border bg-brand-soft">
      <div className="container-shell py-20 md:py-28">
        <div className="max-w-3xl">
          <Eyebrow className="text-brand-ink/70">{copy.whyLivd.contributeCta}</Eyebrow>

          <h2 className="mt-5 font-display text-display-lg tracking-display text-brand-ink">
            {copy.whyLivd.contributeTitle}
          </h2>

          <p className="mt-6 text-body-lg text-brand-ink/85">{copy.whyLivd.contributeOpening}</p>

          {/* The claim, given its own line and the largest type on the page
              after the title. Everything below it is the evidence for it. */}
          <p className="mt-10 font-display text-display-md tracking-display text-brand-ink">
            {copy.whyLivd.contributeClaim}
          </p>

          <ul className="mt-8 grid grid-cols-1 gap-x-10 gap-y-3 sm:grid-cols-2">
            {copy.whyLivd.contributeKnows.map((item) => (
              <li
                key={item}
                className="flex items-start gap-3 border-t border-brand-ink/15 pt-3 text-body text-brand-ink/85"
              >
                {item}
              </li>
            ))}
          </ul>

          <p className="mt-10 font-display text-title-lg tracking-tightish text-brand-ink">
            {copy.whyLivd.contributeMinutes}
          </p>

          <p className="mt-4 max-w-prose text-body text-brand-ink/85">
            {copy.whyLivd.contributeWorth}
          </p>

          <p className="mt-8 max-w-prose text-label text-brand-ink/70">
            {copy.whyLivd.contributeAnonymity}
          </p>

          <p className="mt-8 font-display text-title-lg tracking-tightish text-brand-ink">
            {copy.whyLivd.contributeClose}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
            <ButtonLink href="/review" size="lg">
              {copy.whyLivd.contributeCta}
            </ButtonLink>
            <Link
              href="/trust"
              className="rounded-sm text-label font-medium text-brand-ink underline underline-offset-4 hover:text-brand-ink/80"
            >
              {copy.whyLivd.contributeTrustCta}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * One review
 * ---------------------------------------------------------------------- */

function BetterQuestionSection() {
  return (
    <section className="container-shell py-20 md:py-24">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
        <div>
          <h2 className="font-display text-display-md tracking-display text-ink">
            {copy.whyLivd.questionTitle}
          </h2>
          <p className="mt-4 text-body-lg text-ink-muted">{copy.whyLivd.questionLead}</p>
        </div>

        <div className="flex flex-col gap-5 lg:pt-3">
          <p className="text-body text-ink">{copy.whyLivd.questionBody}</p>
          <p className="border-l-2 border-brand-border pl-5 font-display text-title-md tracking-tightish text-ink">
            {copy.whyLivd.questionClose}
          </p>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * Trust
 * ---------------------------------------------------------------------- */

/**
 * The trust statement is the largest single line on the page.
 *
 * "Anonymous to the public. Accountable to Livd." is the product's whole
 * position on identity in nine words, and both halves have to land or the
 * sentence is marketing. The pillars underneath are what makes each half
 * true, so they follow rather than lead.
 */
function TrustSection() {
  return (
    <section className="border-y border-border bg-surface">
      <div className="container-shell py-20 md:py-24">
        <div className="max-w-3xl">
          <Eyebrow>{copy.whyLivd.trustEyebrow}</Eyebrow>
          <h2 className="mt-5 font-display text-display-lg tracking-display text-ink">
            {copy.whyLivd.trustStatement}
          </h2>
          <p className="mt-6 max-w-xl text-body-lg text-ink-muted">{copy.whyLivd.trustLead}</p>
        </div>

        <dl className="mt-14 grid grid-cols-1 gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          {copy.whyLivd.trustPillars.map((pillar) => (
            <div key={pillar.title} className="border-t border-border pt-5">
              <dt className="font-display text-title-md tracking-tightish text-ink">
                {pillar.title}
              </dt>
              <dd className="mt-2 text-body text-ink-muted">{pillar.body}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-12">
          <ButtonLink href="/trust" variant="secondary">
            {copy.whyLivd.trustCta}
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * What Livd will not do
 * ---------------------------------------------------------------------- */

/**
 * Numbered, because these are commitments rather than features.
 *
 * Each one is something a review platform can be talked into, which is what
 * makes the list worth publishing — a principle nobody is ever tempted to
 * break is not a principle, it is a description.
 */
function WontDoSection() {
  return (
    <section className="container-shell py-20 md:py-24">
      <div className="max-w-2xl">
        <h2 className="font-display text-display-md tracking-display text-ink">
          {copy.whyLivd.wontTitle}
        </h2>
        <p className="mt-4 text-body-lg text-ink-muted">{copy.whyLivd.wontLead}</p>
      </div>

      <ol className="mt-12 flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
        {copy.whyLivd.wont.map((item, index) => (
          <li
            key={item.title}
            className="grid grid-cols-1 gap-x-8 gap-y-2 bg-surface p-7 sm:grid-cols-[auto_minmax(0,1fr)] md:p-8"
          >
            <span
              aria-hidden="true"
              className="font-display text-title-lg tabular text-accent sm:w-10"
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0">
              <h3 className="font-display text-title-lg tracking-tightish text-ink">
                {item.title}
              </h3>
              <p className="mt-2 max-w-prose text-body text-ink-muted">{item.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * Owners
 * ---------------------------------------------------------------------- */

function OwnersSection() {
  return (
    <section className="border-y border-border bg-surface-sunken/50">
      <div className="container-shell py-20 md:py-24">
        <div className="max-w-2xl">
          <h2 className="font-display text-display-md tracking-display text-ink">
            {copy.whyLivd.ownersTitle}
          </h2>
          <p className="mt-4 text-body-lg text-ink-muted">{copy.whyLivd.ownersLead}</p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-16">
          <div>
            <h3 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
              {copy.whyLivd.ownersCanTitle}
            </h3>
            <ul className="mt-5 flex flex-col gap-3">
              {copy.whyLivd.ownersCan.map((item) => (
                <li key={item} className="flex items-start gap-3 text-body text-ink-muted">
                  <Marker tone="positive" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-micro font-semibold uppercase tracking-micro text-ink-subtle">
              {copy.whyLivd.ownersCannotTitle}
            </h3>
            <ul className="mt-5 flex flex-col gap-3">
              {copy.whyLivd.ownersCannot.map((item) => (
                <li key={item} className="flex items-start gap-3 text-body text-ink-muted">
                  <Marker tone="critical" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12">
          <ButtonLink href="/for-owners" variant="secondary">
            {copy.whyLivd.ownersCta}
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * History, global
 * ---------------------------------------------------------------------- */

function HistorySection() {
  return (
    <section className="container-shell py-20 md:py-24">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
        <div>
          <h2 className="font-display text-display-md tracking-display text-ink">
            {copy.whyLivd.historyTitle}
          </h2>
          <p className="mt-4 text-body-lg text-ink-muted">{copy.whyLivd.historyLead}</p>
        </div>
        <p className="text-body text-ink lg:pt-3">{copy.whyLivd.historyBody}</p>
      </div>
    </section>
  );
}

/**
 * Global without a single flag.
 *
 * The cities are named as a list of places with the same question in them,
 * which is the point — the philosophy is what makes Livd global, not
 * iconography.
 */
function GlobalSection() {
  return (
    <section className="border-y border-border bg-surface">
      <div className="container-shell py-20 md:py-24">
        <div className="max-w-3xl">
          <h2 className="font-display text-display-md tracking-display text-ink">
            {copy.whyLivd.globalTitle}
          </h2>
          <p className="mt-5 text-body-lg text-ink-muted">{copy.whyLivd.globalBody}</p>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * How, and the loop
 * ---------------------------------------------------------------------- */

function HowSection() {
  return (
    <section className="container-shell py-20 md:py-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="font-display text-display-md tracking-display text-ink">
          {copy.whyLivd.howTitle}
        </h2>
        <Link
          href="/how-it-works"
          className="rounded-sm text-label font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
        >
          {copy.whyLivd.howCta}
        </Link>
      </div>

      <ol className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-5">
        {copy.whyLivd.howSteps.map((step, index) => (
          <li key={step.title}>
            <div className="flex items-center gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border-strong text-label font-semibold tabular text-ink-muted">
                {index + 1}
              </span>
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
            </div>
            <h3 className="mt-4 font-display text-title-md tracking-tightish text-ink">
              {step.title}
            </h3>
            <p className="mt-2 text-label text-ink-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The loop, as a loop.
 *
 * Rendered as a numbered sequence whose last step is visibly the first step's
 * input — the closing line does that work rather than an arrow graphic, which
 * would need to be redrawn for every breakpoint and would say less.
 */
function LoopSection() {
  return (
    <section className="border-y border-border bg-surface-sunken/50">
      <div className="container-shell py-20 md:py-24">
        <div className="max-w-2xl">
          <h2 className="font-display text-display-md tracking-display text-ink">
            {copy.whyLivd.loopTitle}
          </h2>
          <p className="mt-4 text-body-lg text-ink-muted">{copy.whyLivd.loopLead}</p>
        </div>

        <ol className="mt-12 flex flex-col">
          {copy.whyLivd.loopSteps.map((step, index) => (
            <li
              key={step}
              className="flex items-baseline gap-5 border-t border-border py-5 last:border-b"
            >
              <span
                aria-hidden="true"
                className="shrink-0 font-display text-title-md tabular text-ink-subtle"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="text-body-lg text-ink">{step}</span>
            </li>
          ))}
        </ol>

        <p className="mt-8 max-w-prose text-body text-ink-muted">{copy.whyLivd.loopClose}</p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * Close
 * ---------------------------------------------------------------------- */

/**
 * Ends in the product, not in a newsletter.
 *
 * Search is the primary action because the reader arrived with somewhere in
 * mind; contributing is offered beside it for the reader who has already
 * lived somewhere, which by this point in the page is the more interesting
 * half of the audience.
 */
function CloseSection() {
  return (
    <section className="container-shell py-20 md:py-28">
      <div className="max-w-3xl">
        <h2 className="font-display text-display-lg tracking-display text-ink">
          {copy.whyLivd.closeTitle}
        </h2>
        <p className="mt-5 max-w-xl text-body-lg text-ink-muted">{copy.whyLivd.closeBody}</p>

        <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
          <ButtonLink href="/search" size="lg">
            {copy.whyLivd.searchCta}
          </ButtonLink>

          <p className="text-label text-ink-subtle">
            {copy.whyLivd.closeContributeAside}{' '}
            <Link
              href="/review"
              className="rounded-sm font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
            >
              {copy.whyLivd.contributeCta}
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * Shared
 * ---------------------------------------------------------------------- */

/**
 * A list marker that carries no meaning by itself.
 *
 * The tone is reinforcement for readers who can see it; the list's own heading
 * ("What an owner cannot do") is what actually says which kind of list this
 * is, so nothing here depends on distinguishing the colours.
 */
function Marker({ tone }: { tone: 'neutral' | 'accent' | 'positive' | 'critical' }) {
  const tones = {
    neutral: 'bg-border-strong',
    accent: 'bg-accent',
    positive: 'bg-positive',
    critical: 'bg-critical',
  };

  return (
    <span
      aria-hidden="true"
      className={`mt-[0.55em] size-1.5 shrink-0 rounded-full ${tones[tone]}`}
    />
  );
}
