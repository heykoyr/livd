'use client';

import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { copy } from '@/content/copy';
import { signOut } from '@/server/actions/auth';

export function SignOutButton({
  fullWidth = false,
  variant = 'secondary',
}: {
  fullWidth?: boolean;
  variant?: 'secondary' | 'ghost';
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant={variant}
      size={fullWidth ? 'lg' : 'sm'}
      fullWidth={fullWidth}
      loading={pending}
      onClick={() => startTransition(() => void signOut())}
    >
      {copy.nav.signOut}
    </Button>
  );
}
