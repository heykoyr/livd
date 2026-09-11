import Link from 'next/link';
import type { ComponentPropsWithoutRef, ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * All button styling in one place, shared by `<button>` and link-styled-as-button.
 *
 * Every size clears a 44px hit target on touch via padding plus line-height, so
 * a small button is visually small without becoming hard to hit.
 */
const base =
  'relative inline-flex items-center justify-center gap-2 rounded-md font-medium ' +
  'transition-colors duration-fast ease-[cubic-bezier(0.2,0,0,1)] ' +
  'disabled:pointer-events-none disabled:opacity-45 ' +
  'aria-disabled:pointer-events-none aria-disabled:opacity-45 ' +
  'whitespace-nowrap';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-canvas hover:bg-brand-hover',
  secondary:
    'bg-surface text-ink border border-border-strong hover:bg-surface-sunken hover:border-ink-subtle',
  ghost: 'text-ink hover:bg-surface-sunken',
  danger: 'bg-critical text-white hover:opacity-90',
  quiet: 'bg-brand-soft text-brand-ink border border-brand-border hover:bg-brand-border/60',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-label',
  md: 'h-11 px-4 text-body',
  lg: 'h-12 px-6 text-body-lg',
};

export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cn(base, variants[variant], sizes[size], className);
}

interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks interaction without collapsing the layout. */
  loading?: boolean;
  loadingLabel?: string;
  fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingLabel,
  fullWidth = false,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      // aria-disabled rather than disabled while loading, so the button keeps
      // focus and a screen reader is not silently moved elsewhere mid-action.
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, cn(fullWidth && 'w-full', className))}
      {...props}
    >
      {loading ? (
        <>
          <Spinner />
          <span>{loadingLabel ?? children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

interface ButtonLinkProps extends ComponentPropsWithoutRef<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children: ReactNode;
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      className={buttonClasses(variant, size, cn(fullWidth && 'w-full', className))}
      {...props}
    >
      {children}
    </Link>
  );
}

// `WithRef`, so a caller can hold on to the element — the mobile drawer needs
// it to return focus to the trigger on Escape. React 19 passes `ref` through
// as an ordinary prop, so spreading it below is all the forwarding required.
interface IconButtonProps extends ComponentPropsWithRef<'button'> {
  /** Required — an icon-only control must still have an accessible name. */
  label: string;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
}

export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  className,
  children,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        base,
        variants[variant],
        // `tap-target` keeps the 36px box and gives the thumb 44px.
        size === 'sm' ? 'tap-target size-9' : 'size-11',
        'shrink-0 p-0',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('size-4 animate-spin', className)}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M14.5 8A6.5 6.5 0 0 0 8 1.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
