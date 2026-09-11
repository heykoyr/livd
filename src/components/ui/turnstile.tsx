'use client';

import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The bot check, as a person experiences it.
 *
 * Which is, almost always, not at all. `interaction-only` renders nothing
 * unless Cloudflare decides this visitor needs a challenge, so the common
 * case is an invisible token arriving a second after the script loads. The
 * box only appears for the traffic that earned it.
 *
 * Rendered explicitly rather than by dropping a `.cf-turnstile` div and
 * letting the script find it. Implicit rendering scans the DOM once on load,
 * which is wrong for a wizard whose last step did not exist when the script
 * ran, and it injects a hidden input that React then has opinions about.
 * Explicit rendering gives a callback, and the token lives in React state
 * like any other value.
 *
 * It returns null when no site key is configured — the server decides
 * separately whether a token is required, from a secret the browser never
 * sees, so an unconfigured deployment simply has no check rather than a
 * broken one.
 */

interface TurnstileApi {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
      'timeout-callback'?: () => void;
      theme?: 'auto' | 'light' | 'dark';
      appearance?: 'always' | 'execute' | 'interaction-only';
      action?: string;
    },
  ) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function turnstileConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}

export function Turnstile({
  onToken,
  /** Distinguishes the surfaces in Cloudflare's own analytics. */
  action,
}: {
  onToken: (token: string | null) => void;
  action: string;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  // Held in a ref, and updated in an effect rather than during render. The
  // callback identity must not be a dependency of the widget effect below,
  // or a parent re-render tears the widget down and rebuilds it — losing the
  // token, and asking the visitor to solve a challenge twice.
  const handleToken = useRef(onToken);
  useEffect(() => {
    handleToken.current = onToken;
  }, [onToken]);

  const onLoad = useCallback(() => setReady(true), []);

  useEffect(() => {
    if (!siteKey || !ready || !container.current || !window.turnstile) return;
    if (widgetId.current !== null) return;

    widgetId.current = window.turnstile.render(container.current, {
      sitekey: siteKey,
      action,
      appearance: 'interaction-only',
      theme: 'auto',
      callback: (token) => handleToken.current(token),
      // A token is single-use and lives about five minutes. Clearing it on
      // expiry means the form knows it has nothing rather than submitting
      // something Cloudflare will refuse.
      'expired-callback': () => handleToken.current(null),
      'error-callback': () => handleToken.current(null),
      'timeout-callback': () => handleToken.current(null),
    });

    return () => {
      const id = widgetId.current;
      widgetId.current = null;
      if (id !== null) window.turnstile?.remove(id);
    };
  }, [siteKey, ready, action]);

  if (!siteKey) return null;

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="lazyOnload"
        onLoad={onLoad}
        onReady={onLoad}
      />
      {/* Empty until Cloudflare decides otherwise, so it takes no space in
          the common case and does not leave a labelled gap in the layout. */}
      <div ref={container} className="empty:hidden" />
    </>
  );
}
