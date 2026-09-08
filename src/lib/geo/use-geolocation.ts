'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * A single position reading, on request.
 *
 * `getCurrentPosition`, never `watchPosition`. The distinction is the whole
 * privacy posture of this feature expressed in one API choice: a watch is a
 * subscription to where somebody is going, and Livd has no use for one. This
 * asks once, when a person presses a button, and stops.
 *
 * There is no polling, no background timer, no permission request on mount and
 * no reading taken before a control is pressed. The browser's own permission
 * prompt is the only prompt, and it appears after Livd has already said in
 * plain words why it is about to appear.
 *
 * The reading is held in component state for exactly as long as it takes to
 * submit it, and `clear()` drops it. Nothing writes it to storage.
 */

export type GeolocationErrorKind =
  | 'unsupported'
  | 'permission_denied'
  | 'unavailable'
  | 'timeout';

export interface GeolocationReading {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAtMs: number;
}

export interface GeolocationState {
  status: 'idle' | 'requesting' | 'ready' | 'error';
  reading: GeolocationReading | null;
  error: GeolocationErrorKind | null;
}

const INITIAL: GeolocationState = { status: 'idle', reading: null, error: null };

/**
 * `enableHighAccuracy` is on because the whole question is which building
 * somebody is at, and a network-derived fix answers it at the wrong scale.
 * The timeout is generous: a cold GPS fix indoors genuinely takes fifteen
 * seconds, and a product that gives up at five turns away exactly the people
 * standing inside the building it is asking about.
 *
 * `maximumAge: 0` refuses a cached fix. A position from an hour ago is a
 * different claim from the one being made.
 */
const OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 20_000,
  maximumAge: 0,
};

export function useGeolocation(): GeolocationState & {
  request: () => Promise<GeolocationReading | null>;
  clear: () => void;
} {
  const [state, setState] = useState<GeolocationState>(INITIAL);
  // Guards a second request while one is in flight — pressing the button twice
  // otherwise stacks two permission prompts on some mobile browsers.
  const pending = useRef(false);

  const request = useCallback(async (): Promise<GeolocationReading | null> => {
    if (pending.current) return null;

    // The value, not the key. `'geolocation' in navigator` is true on a
    // non-secure origin and in several embedded webviews while the property
    // itself is undefined, so the `in` check passes and the call below throws.
    if (typeof navigator === 'undefined' || typeof navigator.geolocation?.getCurrentPosition !== 'function') {
      setState({ status: 'error', reading: null, error: 'unsupported' });
      return null;
    }

    pending.current = true;
    setState({ status: 'requesting', reading: null, error: null });

    return new Promise<GeolocationReading | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          pending.current = false;
          const reading: GeolocationReading = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            // Some browsers report null accuracy. Treated as "unknown and
            // therefore large" rather than as zero, which would read as a
            // perfect fix and is the wrong way to be wrong.
            accuracyMeters: Number.isFinite(position.coords.accuracy)
              ? position.coords.accuracy
              : 9999,
            capturedAtMs: position.timestamp || Date.now(),
          };
          setState({ status: 'ready', reading, error: null });
          resolve(reading);
        },
        (error) => {
          pending.current = false;
          setState({
            status: 'error',
            reading: null,
            error:
              error.code === error.PERMISSION_DENIED
                ? 'permission_denied'
                : error.code === error.TIMEOUT
                  ? 'timeout'
                  : 'unavailable',
          });
          resolve(null);
        },
        OPTIONS,
      );
    });
  }, []);

  const clear = useCallback(() => {
    pending.current = false;
    setState(INITIAL);
  }, []);

  return { ...state, request, clear };
}
