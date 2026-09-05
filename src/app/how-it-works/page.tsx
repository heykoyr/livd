import type { Metadata } from 'next';

import { ProsePage, ProseSection } from '@/components/layout/prose-page';
import { ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { SITE } from '@/config/site';
import { copy } from '@/content/copy';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'How Livd turns individual resident reviews into something you can actually make a decision with.',
  alternates: { canonical: `${SITE.url}/how-it-works` },
};

export default function HowItWorksPage() {
  return (
    <ProsePage
      eyebrow="How it works"
      title="From one person's experience to something you can decide on"
      lead="A single review is an anecdote. Livd's job is to turn a property's whole history of them into an answer."
    >
      <ProseSection title="Residents answer specific questions">
        <p>
          Instead of a text box, Livd asks a sequence of short questions: how long you lived
          there, how you rate the things that actually matter in a home, what was good, what was
          difficult, and — if you have moved out — why you left.
        </p>
        <p>
          That structure is the whole point. Prose cannot be counted across nine residents and
          four years. Structured answers can.
        </p>
      </ProseSection>

      <ProseSection title="The questions adapt to where the property is">
        <p>
          Some things matter everywhere: the state of the building, whether management answers,
          whether it felt safe, what it cost. Those are asked of everyone.
        </p>
        <p>
          Others are local. A resident in Lagos is asked about water supply and power
          reliability. A resident in Manchester is asked about damp and heating. Nobody is asked
          to rate something irrelevant to where they live, and no property is scored on a
          category its residents never rated.
        </p>
      </ProseSection>

      <ProseSection title="The score is a judgement, not an average">
        <p>
          Livd publishes a score out of 100 rather than stars, because it is not a star average
          and should not be mistaken for one. Recent reviews weigh more than old ones. Verified
          residents weigh more than unverified ones. A property with three reviews is pulled
          toward the middle rather than allowed to look outstanding on thin evidence.
        </p>
        <p>
          Every score is shown with how much evidence sits behind it. Below a threshold, no
          score is shown at all and the page says so plainly.
        </p>
      </ProseSection>

      <ProseSection title="Why people left is the most useful thing here">
        <p>
          Everyone leaves eventually. What matters is whether the property drove them out.
          Livd separates reasons caused by the property — maintenance, management, rent rises,
          utilities — from reasons caused by life, like buying a home or moving city. A building
          everyone left because they bought houses is not a bad building, and the chart never
          implies otherwise.
        </p>
      </ProseSection>

      <ProseSection title="Then it hands you questions to ask">
        <p>
          The most practical thing on a property page is the list of questions drawn from what
          residents actually raised. Ask them at the viewing, in those words, and you will learn
          more in five minutes than any listing will tell you in an hour.
        </p>
      </ProseSection>

      <Card className="p-6 md:p-8">
        <h2 className="font-display text-title-lg tracking-tightish text-ink">
          The part that only works if you do it
        </h2>
        <p className="mt-3 text-body-lg text-ink-muted">
          Every property page exists because somebody wrote the first review. If you have rented
          in the last few years, you know something the next person does not — and it takes about
          four minutes to pass on.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/review" size="lg">
            {copy.nav.writeReview}
          </ButtonLink>
          <ButtonLink href="/trust" variant="secondary" size="lg">
            {copy.nav.trust}
          </ButtonLink>
        </div>
      </Card>
    </ProsePage>
  );
}
