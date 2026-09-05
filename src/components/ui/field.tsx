import { useId, type ComponentPropsWithoutRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Form field wiring.
 *
 * `Field` owns the ids and the `aria-describedby` chain, and passes them to the
 * control through a render prop. That is deliberate: it makes correct
 * association the default rather than something each form has to remember, and
 * it is why no form in this codebase has an unlabelled input or an error a
 * screen reader cannot reach.
 */

export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': boolean | undefined;
}

export function Field({
  label,
  hint,
  error,
  optional = false,
  className,
  labelClassName,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
  className?: string;
  labelClassName?: string;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={cn('text-label font-medium text-ink', labelClassName)}>
        {label}
        {optional && <span className="ml-1.5 font-normal text-ink-subtle">Optional</span>}
      </label>

      {hint && (
        <p id={hintId} className="text-label text-ink-muted">
          {hint}
        </p>
      )}

      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}

      {error && (
        <p
          id={errorId}
          // Errors appear after an action, so they must be announced.
          role="alert"
          className="flex items-start gap-1.5 text-label text-critical"
        >
          <AlertIcon />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

const controlBase =
  'w-full rounded-md border bg-surface px-3 text-body text-ink placeholder:text-ink-subtle ' +
  'transition-colors duration-fast ' +
  'aria-[invalid=true]:border-critical ' +
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-subtle';

export function Input({ className, ...props }: ComponentPropsWithoutRef<'input'>) {
  return (
    <input
      className={cn(controlBase, 'h-11 border-border-strong hover:border-ink-subtle', className)}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentPropsWithoutRef<'textarea'>) {
  return (
    <textarea
      className={cn(
        controlBase,
        'min-h-32 resize-y border-border-strong py-2.5 leading-relaxed hover:border-ink-subtle',
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: ComponentPropsWithoutRef<'select'>) {
  return (
    <div className="relative">
      <select
        className={cn(
          controlBase,
          'h-11 appearance-none border-border-strong pr-9 hover:border-ink-subtle',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronIcon className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
    </div>
  );
}

/** Live character counter. Announced politely so typing is not interrupted. */
export function CharacterCount({
  used,
  max,
  className,
}: {
  used: number;
  max: number;
  className?: string;
}) {
  const nearLimit = used > max * 0.9;

  return (
    <p
      aria-live="polite"
      className={cn(
        'text-micro tabular',
        nearLimit ? 'text-caution' : 'text-ink-subtle',
        className,
      )}
    >
      {used.toLocaleString()} of {max.toLocaleString()} characters
    </p>
  );
}

/** Form-level error summary, focusable so submission failures land somewhere. */
export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;

  return (
    <div
      role="alert"
      tabIndex={-1}
      className="flex items-start gap-2 rounded-md border border-critical/30 bg-critical-soft px-3.5 py-3 text-body text-critical"
    >
      <AlertIcon className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('size-4 shrink-0', className)}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.75" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4.75v3.75" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11" r="0.85" fill="currentColor" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m4 6 4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
