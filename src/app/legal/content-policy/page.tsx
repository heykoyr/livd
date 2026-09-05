import type { Metadata } from 'next';

import { ProseList, ProsePage, ProseSection } from '@/components/layout/prose-page';
import { SITE, LIMITS } from '@/config/site';

export const metadata: Metadata = {
  title: 'Content policy',
  description: 'What may and may not be published on Livd, and how those rules are enforced.',
  alternates: { canonical: `${SITE.url}/legal/content-policy` },
};

export default function ContentPolicyPage() {
  return (
    <ProsePage
      eyebrow="Legal"
      title="Content policy"
      lead="What may be published on Livd, what may not, and what happens when something crosses the line."
      updated="September 2026"
    >
      <ProseSection title="What Livd is for">
        <p>
          Livd records what it is like to live in a property. Reviews are about the building,
          the home, the services it depends on and the experience of renting it. They are not
          about individual people.
        </p>
        <p>
          That distinction is the single most important rule here, and most of what follows is a
          consequence of it.
        </p>
      </ProseSection>

      <ProseSection title="Refused before publication">
        <p>Livd will not publish a review containing:</p>
        <ProseList
          items={[
            'Phone numbers, email addresses, links or messaging handles, whether your own or anyone else’s.',
            'Unit, flat or apartment numbers — these identify a household rather than a property.',
            'The name of any individual, including landlords, agents, caretakers, security staff, neighbours and other residents.',
            'Threats of any kind, or content directed at degrading a person.',
            'Content targeting people on the basis of race, religion, nationality, immigration status, sexuality, gender identity, disability or family status.',
          ]}
        />
        <p>
          Where something is refused, you are told exactly what to change and your review is kept
          so you can fix it rather than rewrite it.
        </p>
      </ProseSection>

      <ProseSection title="Held for review">
        <p>
          Serious allegations — theft, fraud, assault and similar — stated as established fact
          are held for a person to read before publication. They are not refused. A resident
          whose deposit was genuinely withheld must be able to say so.
        </p>
        <p>
          Writing the same thing as your own account, rather than as a finding of fact, is both
          more publishable and more credible.
        </p>
      </ProseSection>

      <ProseSection title="You must have lived there">
        <p>
          Only write about a property you have actually lived in. Reviews from people who did
          not live there are removed when identified, and repeated attempts end the account.
        </p>
        <p>
          One published review per person, per property, per tenancy. If you lived somewhere
          twice, years apart, those are two tenancies.
        </p>
      </ProseSection>

      <ProseSection title="Corrections and permanence">
        <p>
          You can correct your review for {LIMITS.reviewEditWindowHours} hours after publishing —
          long enough to fix a typo or clarify a sentence. After that it becomes part of the
          property&rsquo;s permanent record, because a review that can be rewritten later is not
          a record of anything.
        </p>
        <p>
          Deleting your account does not delete your published reviews. They remain, permanently
          unlinked from you, because the property record other renters rely on is the thing
          being protected.
        </p>
      </ProseSection>

      <ProseSection title="Enforcement">
        <p>
          Reports are read by a person. Nothing is removed automatically, and a report on its own
          removes nothing — it opens a decision. Every moderation decision records who made it
          and why in a log that cannot be edited or deleted by anyone, including us.
        </p>
        <p>
          If a review contains private information about you, report it and say so. Those are
          prioritised.
        </p>
      </ProseSection>
    </ProsePage>
  );
}
