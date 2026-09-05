import type { Metadata } from 'next';

import { ProseList, ProsePage, ProseSection } from '@/components/layout/prose-page';
import { SITE } from '@/config/site';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'The terms on which Livd may be used.',
  alternates: { canonical: `${SITE.url}/legal/terms` },
};

/**
 * Terms.
 *
 * Deliberately short and readable. These describe how the product actually
 * behaves and must be reviewed by counsel in each launch market before launch —
 * they are not a substitute for that review.
 */
export default function TermsPage() {
  return (
    <ProsePage
      eyebrow="Legal"
      title="Terms"
      lead="The short version: write honestly about places you have lived, do not write about people, and understand that what you publish stays."
      updated="September 2026"
    >
      <ProseSection title="What Livd is">
        <p>
          Livd publishes accounts written by residents about properties they have lived in. It
          is not a letting agent, does not broker tenancies, and has no commercial relationship
          with any property on the platform.
        </p>
        <p>
          Reviews are the opinions and recollections of the people who wrote them. Livd does not
          verify the truth of every statement, and scores are computed from what residents
          reported rather than from any inspection of the property.
        </p>
      </ProseSection>

      <ProseSection title="Using Livd">
        <p>Reading Livd requires no account. An account is needed to:</p>
        <ProseList
          items={[
            'Publish a review.',
            'Save properties to a shortlist.',
            'Report content.',
            'Claim a property as its owner or managing agent.',
          ]}
        />
        <p>
          You must be old enough to enter a tenancy agreement where you live, and you must not
          create more than one account.
        </p>
      </ProseSection>

      <ProseSection title="What you publish">
        <p>
          Write only about properties you have actually lived in, and only about your own
          experience. The content policy sets out what may and may not be published; it forms
          part of these terms.
        </p>
        <p>
          You keep ownership of what you write. By publishing on Livd you grant Livd a
          non-exclusive right to display it, and to include it in aggregate statistics about the
          property, for as long as the property record exists.
        </p>
        <p>
          You may correct a review for a short window after publishing. After that it becomes
          part of the property&rsquo;s permanent record and cannot be edited or withdrawn.
        </p>
      </ProseSection>

      <ProseSection title="Property owners">
        <p>
          Verified owners and managing agents may claim a property, correct factual details and
          reply publicly to reviews. They cannot edit, hide or remove reviews. Attempting to
          obtain removal by misrepresentation, or to have residents submit reviews on request,
          ends the claim and may end the account.
        </p>
      </ProseSection>

      <ProseSection title="Moderation">
        <p>
          Livd may remove content that breaks the content policy, and may restrict or end an
          account that repeatedly does. Removal decisions are made by people, recorded with a
          reason, and can be appealed by contacting us.
        </p>
      </ProseSection>

      <ProseSection title="No warranty">
        <p>
          Livd is provided as it is. Decisions about where to live are yours, and Livd is one
          input among several — it is not a substitute for viewing a property, reading a
          tenancy agreement or taking professional advice.
        </p>
      </ProseSection>

      <ProseSection title="These terms">
        <p>
          These terms describe how the product behaves and are written to be readable rather
          than exhaustive. They will be reviewed by qualified counsel in each market before
          launch, and the governing law and dispute process will be set out then.
        </p>
      </ProseSection>
    </ProsePage>
  );
}
