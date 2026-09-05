import type { Metadata } from 'next';

import { ProseList, ProsePage, ProseSection } from '@/components/layout/prose-page';
import { ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { SITE } from '@/config/site';

export const metadata: Metadata = {
  title: 'For property owners',
  description:
    'What owners and managing agents can do on Livd, what they cannot, and why the second list is the point.',
  alternates: { canonical: `${SITE.url}/for-owners` },
};

/**
 * For owners.
 *
 * Written to be read by someone who has just found a bad review of their
 * property and is looking for the delete button. Saying plainly that there
 * isn't one — and why — is more useful to them than a softer page would be.
 */
export default function ForOwnersPage() {
  return (
    <ProsePage
      eyebrow="For property owners"
      title="You can reply. You cannot remove."
      lead="If you have found a review of your property and want it taken down, this page explains where you actually stand — and what is worth doing instead."
    >
      <ProseSection title="Claim the property">
        <p>
          Owners, managing agents and letting agents can claim a property. Claims are verified
          before approval, and only one account can hold a property at a time.
        </p>
        <p>Claiming gives you three things:</p>
        <ProseList
          items={[
            'The ability to correct factual details about the property.',
            'One public reply to each review, shown directly beneath it.',
            'The ability to mark an issue a resident raised as resolved.',
          ]}
        />
      </ProseSection>

      <ProseSection title="What it does not give you">
        <p>
          You cannot edit, hide, reorder or delete a review. This is not a policy that a
          sufficiently persistent request could change: there is no field in Livd&rsquo;s
          database and no permission anywhere in it that would let a property owner alter a
          review&rsquo;s visibility. Only a moderator can change a review&rsquo;s status, only
          against the published content rules, and every such decision is written to a log that
          nobody can edit.
        </p>
        <p>
          You also cannot review a property you have claimed. If you have already reviewed it as
          a resident, you cannot claim it.
        </p>
        <p>
          This is not hostility toward owners. It is the only arrangement under which a renter
          has any reason to believe what they read here — and a platform renters do not believe
          is worth nothing to you either.
        </p>
      </ProseSection>

      <ProseSection title="If a review breaks the rules, report it">
        <p>
          Reviews containing contact details, unit numbers, named individuals, threats or
          discriminatory content are removed. So is anything a moderator determines was not
          written by a resident. Report it from the property page and a person will read it.
        </p>
        <p>
          A review being unflattering, or wrong in your view, is not by itself grounds for
          removal. That is what the reply is for.
        </p>
      </ProseSection>

      <ProseSection title="What actually works">
        <p>
          The most effective response on Livd is a specific one. &ldquo;The boiler was replaced
          in March and the response time is now under 48 hours&rdquo; changes what a prospective
          renter concludes. A defensive reply confirms the review.
        </p>
        <p>
          Livd shows whether a property is improving. A property whose recent residents rate it
          higher than earlier ones says so on its own page, prominently. That is the number worth
          working on.
        </p>
      </ProseSection>

      <Card className="p-6">
        <h2 className="font-display text-title-md tracking-tightish text-ink">
          Claim a property
        </h2>
        <p className="mt-2 text-body text-ink-muted">
          Find the property on Livd and use &ldquo;Claim this property&rdquo; on its page.
        </p>
        <ButtonLink href="/search" className="mt-5">
          Find your property
        </ButtonLink>
      </Card>
    </ProsePage>
  );
}
