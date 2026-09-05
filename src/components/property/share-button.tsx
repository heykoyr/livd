'use client';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { copy } from '@/content/copy';

/**
 * Share.
 *
 * Uses the platform share sheet where it exists and falls back to copying the
 * link. Both paths share only the page URL — never the reader's identity, and
 * never anything about what else they have been looking at.
 */
export function ShareButton() {
  const toast = useToast();

  async function share(): Promise<void> {
    const url = window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({ title: document.title, url });
        return;
      } catch {
        // The user dismissed the sheet, or the browser refused. Fall through to
        // the clipboard rather than reporting a failure they caused.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      toast.show(copy.property.linkCopied, 'positive');
    } catch {
      toast.show('Could not copy the link. You can copy it from the address bar.', 'critical');
    }
  }

  return (
    <Button variant="secondary" onClick={share}>
      <ShareIcon />
      {copy.property.share}
    </Button>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
      <path
        d="M8 10.5V2.5m0 0L5.2 5.3M8 2.5l2.8 2.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 9.5v3a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
