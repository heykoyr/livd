import type { Metadata } from 'next';

import { ProseList, ProsePage, ProseSection } from '@/components/layout/prose-page';
import { ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { DEPARTURE_DISCLOSURE_THRESHOLD } from '@/config/departure-reasons';
import { SCORING } from '@/lib/intelligence/scoring';
import { SITE } from '@/config/site';

export const metadata: Metadata = {
  title: 'Trust & safety',
  description:
    'How Livd protects the people who write reviews, what property owners can and cannot do, and why some numbers are withheld.',
  alternates: { canonical: `${SITE.url}/trust` },
};

/**
 * Trust and safety.
 *
 * States the actual rules, including the thresholds, read from the same
 * constants the product enforces — so this page cannot drift out of agreement
 * with the code it describes.
 */
export default function TrustPage() {
  return (
    <ProsePage
      eyebrow="Trust & safety"
      title="How Livd stays worth believing"
      lead="A review platform is only as useful as it is honest. These are the rules, including the ones that make Livd less impressive than it could otherwise look."
    >
      <ProseSection title="You are never named">
        <p>
          A review shows whether you lived at the property, roughly how long for, and whether
          that was verified. Nothing else. There is no author name, no handle, no avatar and no
          profile to click through to — Livd has no public profiles at all, because a profile is
          a way to connect a person to what they wrote.
        </p>
        <p>
          Your account holds an email address and, if you set one, a country. There is no name,
          phone number or address on it, because none is ever collected.
        </p>
      </ProseSection>

      <ProseSection title="What a review may not contain">
        <p>
          Every review is checked before it is published. These are refused outright, with an
          explanation of exactly what to change:
        </p>
        <ProseList
          items={[
            'Contact details of any kind — phone numbers, email addresses, links, messaging handles.',
            'Unit, flat or apartment numbers. A unit number identifies a household, not a property.',
            'Named individuals. Reviews are about the property and what living there was like.',
            'Threats, harassment, or content targeting people for who they are.',
          ]}
        />
        <p>
          Serious allegations stated as established fact are not refused, but they are held for a
          person to read before publication. Someone whose deposit really was withheld must be
          able to say so; an accusation against a named business should not go up unread.
        </p>
      </ProseSection>

      <ProseSection title="Property owners can reply. They cannot remove.">
        <p>
          An owner or managing agent can claim a property, correct factual details about it, and
          reply publicly to any review — once per review. They can mark an issue as resolved.
        </p>
        <p>
          They cannot edit, hide, reorder or delete a review, and this is not a policy that could
          quietly change. There is no column in the database and no permission anywhere in it
          that would let a claimant alter a review&rsquo;s visibility. Someone who has claimed a
          property also cannot review it.
        </p>
      </ProseSection>

      <ProseSection title="Why some numbers are missing">
        <p>
          Livd would look more finished if every property had a score. Several deliberately do
          not.
        </p>
        <ProseList
          items={[
            `A property needs the equivalent of ${SCORING.confidence.limited} recent reviews before any score is published at all. Below that the page says what it does not know.`,
            `A category is scored only once ${SCORING.categoryMinSample} residents have rated it — and only where residents actually rated it, so a London flat is never scored on generator reliability.`,
            `"Why residents leave" appears only once ${DEPARTURE_DISCLOSURE_THRESHOLD} former residents have given a reason. One person's answer rendered as "100% left because of X" is both meaningless and potentially identifying.`,
            'A trend is shown only when there are enough reviews in two separate periods to compare them.',
          ]}
        />
        <p>
          Every score carries its confidence and the number of reviews behind it. A number
          without its basis is the thing this product exists not to publish.
        </p>
      </ProseSection>

      <ProseSection title="How the score is weighted">
        <p>
          Recent reviews count for more than old ones — a property under new management should
          not be judged forever on how it was run years ago, though history is diluted rather
          than erased. Verified residents count for more than unverified ones. A property with
          few reviews is pulled toward the middle rather than allowed to produce an extreme
          score from thin evidence.
        </p>
        <p>
          A review whose authenticity is under dispute contributes nothing to the score until
          that is resolved. It stays visible, and it is labelled.
        </p>
      </ProseSection>

      <ProseSection title="Manipulation">
        <p>
          One published review per person, per property, per tenancy. Owners cannot review their
          own properties. Submissions and reports are rate limited. An unusual concentration of
          new accounts reviewing one property flags that property for a person to look at.
        </p>
        <p>
          Reporting a review opens a decision; it never makes one. Nothing is removed
          automatically, so a coordinated reporting campaign cannot take a review down.
        </p>
      </ProseSection>

      <ProseSection title="Moderation is on the record">
        <p>
          A review is never deleted. Its status changes, and every change is written to an
          append-only log with who made it, both statuses and a written reason. No role can edit
          or delete that log. A published record that can vanish without trace is not a record.
        </p>
      </ProseSection>

      <Card className="p-6">
        <h2 className="font-display text-title-md tracking-tightish text-ink">
          Something wrong on Livd?
        </h2>
        <p className="mt-2 text-body text-ink-muted">
          Report the review from the property page and a moderator will look at it. If a review
          contains private information about you, say so in the report — those are prioritised.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <ButtonLink href="/legal/content-policy" variant="secondary">
            Read the content policy
          </ButtonLink>
          <ButtonLink href="/for-owners" variant="secondary">
            For property owners
          </ButtonLink>
        </div>
      </Card>
    </ProsePage>
  );
}
