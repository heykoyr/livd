import type { Metadata } from 'next';

import { ProseList, ProsePage, ProseSection } from '@/components/layout/prose-page';
import { SITE } from '@/config/site';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What Livd collects, what it deliberately does not, and why.',
  alternates: { canonical: `${SITE.url}/legal/privacy` },
};

/**
 * Privacy.
 *
 * Describes the system as actually built. Where the product declines to collect
 * something, that is stated as a design decision rather than a promise — a
 * field that does not exist cannot leak, and that is a stronger guarantee than
 * a policy.
 *
 * This is a plain-English description of the implementation, not legal advice,
 * and it needs review by counsel in each launch market before launch.
 */
export default function PrivacyPage() {
  return (
    <ProsePage
      eyebrow="Legal"
      title="Privacy"
      lead="Livd is a platform where people describe where they live. Most of this page is about what is deliberately not collected."
      updated="September 2026"
    >
      <ProseSection title="What an account holds">
        <p>Your account holds two things:</p>
        <ProseList
          items={[
            'Your email address, so you can sign in and so one person cannot review the same property twice.',
            'Optionally, your country — used to decide how addresses, dates and currency are shown to you.',
          ]}
        />
        <p>
          There is no name field, no phone number field and no address field on a Livd account.
          Not left blank — absent. A field that does not exist cannot be leaked, subpoenaed or
          exposed by a future bug.
        </p>
        <p>Livd never stores a password, because it never asks for one.</p>
      </ProseSection>

      <ProseSection title="What a published review reveals">
        <p>
          A review shows whether you were a current or former resident, roughly how long you
          lived there, the year you left, whether your residency was verified, and what you
          wrote. Nothing connects it to you publicly — there is no author name, no handle and no
          profile page anywhere on Livd.
        </p>
        <p>
          Dates are stored to the month, never the day, so a tenancy cannot be matched against a
          specific letting record. Unit and apartment numbers are refused at submission.
        </p>
      </ProseSection>

      <ProseSection title="What is never public">
        <ProseList
          items={[
            'Your email address.',
            'Which properties you have saved. Not visible to anyone, including the property owner — a landlord learning who is researching them is an obvious way this data could be turned against the people it exists to serve.',
            'Which reviews you reported. The reviewer is never told who reported them.',
            'Any evidence submitted for verification. Stored where no user-facing account can read it, including yours.',
          ]}
        />
      </ProseSection>

      <ProseSection title="Search">
        <p>
          Livd records that a search happened, roughly where it was for, and how many results it
          returned — because the product needs to know which places it has no data on.
        </p>
        <p>
          It does not record who searched, and it does not store the query itself, only a hash
          of it. Your search history cannot be reconstructed against you, because it is not
          stored in a form that would allow it.
        </p>
      </ProseSection>

      <ProseSection title="Third parties">
        <p>
          Livd runs no third-party analytics, no advertising and no tracking pixels. Fonts are
          served from Livd&rsquo;s own domain rather than a font provider, so loading a page
          sends no request to anyone else.
        </p>
        <p>Livd does not sell data. There is no arrangement under which it would.</p>
      </ProseSection>

      <ProseSection title="Deleting your account">
        <p>
          Deleting your account removes it along with your saved properties and search
          preferences.
        </p>
        <p>
          Published reviews remain, permanently unlinked from you. That is a deliberate trade:
          the property record is what other renters rely on, and letting it be withdrawn later
          would make every property page unreliable. Your reviews were never publicly attached
          to you in the first place.
        </p>
      </ProseSection>

      <ProseSection title="This page">
        <p>
          This is a plain-English description of how Livd is built. It is not legal advice, and
          it will be reviewed by qualified counsel in each market before launch.
        </p>
      </ProseSection>
    </ProsePage>
  );
}
