import type { Metadata } from 'next';

import { copy } from '@/content/copy';
import { requireUserPage } from '@/server/auth/guards';
import { NewPropertyForm } from './new-property-form';

export const metadata: Metadata = {
  title: 'Add a property',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function NewPropertyPage() {
  await requireUserPage('/review/new-property');

  return (
    <div className="container-shell py-10 md:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="font-display text-display-md tracking-display text-ink">
          Add a property
        </h1>
        <p className="mt-3 max-w-prose text-body-lg text-ink-muted">
          Enter the building as it would be addressed — never your unit or apartment number. Livd
          records places, not households, and a property page is public.
        </p>

        <NewPropertyForm />
      </div>
    </div>
  );
}
