'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { IconButton } from './button';

/**
 * Modal dialog and mobile bottom sheet.
 *
 * Built on the native `<dialog>` element. That gives focus trapping, focus
 * restoration, Escape-to-close, inert background content and the top layer for
 * free — all correctly, from the platform, rather than reimplemented and
 * subtly wrong. It is the reason this file is short.
 */

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  /** Renders as a bottom sheet below `sm`, which is the right mobile pattern. */
  sheetOnMobile = true,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  sheetOnMobile?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      // The browser scrolls the page behind an open dialog otherwise.
      document.body.style.overflow = 'hidden';
    } else if (!open && dialog.open) {
      dialog.close();
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // `close` fires for Escape and for form method="dialog" as well as our button,
  // so parent state stays in step however the dialog was dismissed.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    function handleClose(): void {
      onClose();
    }
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  const widths = {
    sm: 'sm:max-w-md',
    md: 'sm:max-w-lg',
    lg: 'sm:max-w-2xl',
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="livd-dialog-title"
      aria-describedby={description ? 'livd-dialog-description' : undefined}
      // Clicking the backdrop closes; clicks inside stop at the panel.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        'backdrop:bg-ink/40 backdrop:backdrop-blur-[1px]',
        'w-full max-w-none bg-transparent p-0 text-ink',
        'open:animate-fade',
        sheetOnMobile
          ? 'mt-auto mb-0 sm:my-auto'
          : 'my-auto',
        'sm:mx-auto',
        widths[size],
      )}
    >
      <div
        className={cn(
          'flex max-h-[85dvh] w-full flex-col overflow-hidden border border-border bg-surface shadow-overlay',
          sheetOnMobile ? 'rounded-t-xl sm:rounded-xl' : 'rounded-xl',
        )}
      >
        {/* Grab affordance — mobile sheets read as draggable even when they are not. */}
        {sheetOnMobile && (
          <div aria-hidden="true" className="mx-auto mt-3 h-1 w-9 rounded-full bg-border-strong sm:hidden" />
        )}

        <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-5 sm:px-6">
          <div className="min-w-0">
            <h2
              id="livd-dialog-title"
              className="font-display text-title-lg tracking-tightish text-ink"
            >
              {title}
            </h2>
            {description && (
              <p id="livd-dialog-description" className="mt-1.5 text-body text-ink-muted">
                {description}
              </p>
            )}
          </div>
          <IconButton label="Close" size="sm" onClick={onClose} className="-mr-2 -mt-1">
            <CloseIcon />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6">{children}</div>

        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-surface-sunken/60 px-5 py-4 sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </dialog>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
      <path
        d="m4 4 8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
