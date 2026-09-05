'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/utils';

/**
 * Toasts.
 *
 * Confirmation for actions whose result is not otherwise visible — saving a
 * property, copying a link. The region is `aria-live="polite"`, so a screen
 * reader hears the confirmation without being interrupted mid-sentence.
 *
 * Never used for errors that require action; those belong inline, next to the
 * thing that failed, where they cannot time out before being read.
 */

type ToastTone = 'neutral' | 'positive' | 'critical';

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  show: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, tone: ToastTone = 'neutral') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        aria-live="polite"
        // The region exists from first render so announcements are not missed.
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex max-w-md items-center gap-2.5 rounded-lg border px-4 py-3 text-body shadow-overlay',
              'animate-in-up',
              toast.tone === 'positive' && 'border-positive/30 bg-positive-soft text-positive',
              toast.tone === 'critical' && 'border-critical/30 bg-critical-soft text-critical',
              toast.tone === 'neutral' && 'border-border bg-surface text-ink',
            )}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
