import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initialNearbyState, type NearbyState } from '@/server/actions/action-state';

/**
 * What "near me" says when it cannot show you anything.
 *
 * A resident standing inside a property they had reviewed was told "No Livd
 * properties within a short walk". The underlying cause was missing
 * coordinates, but the reason it took so long to find is here, in the
 * interface: five different outcomes rendered one sentence, and four of them
 * were saying something untrue.
 *
 * The subtlest of the five is the one these tests exist for. `geo.clear()` ran
 * in a `finally`, so it reset the geolocation hook on every path — including
 * the failures — and erased the error microseconds after it was set. Every
 * outcome then arrived at the render with no error and no items, which is
 * indistinguishable from an empty neighbourhood. A test that only checked the
 * copy would have passed throughout.
 *
 * So each of these presses the button for real and asserts on what a person
 * would read.
 */

const findNearbyProperties = vi.fn<(...args: unknown[]) => Promise<NearbyState>>();

vi.mock('@/server/actions/property-verification', () => ({
  findNearbyProperties: (...args: unknown[]) => findNearbyProperties(...args),
}));

const { NearbyProperties } = await import('@/components/search/nearby-properties');

/** Replaces the browser's geolocation with a scripted one. */
function stubGeolocation(
  behaviour: { kind: 'position' } | { kind: 'error'; code: number } | { kind: 'absent' },
) {
  if (behaviour.kind === 'absent') {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: undefined,
    });
    return vi.fn();
  }

  const getCurrentPosition = vi.fn(
    (onSuccess: PositionCallback, onError?: PositionErrorCallback | null) => {
      if (behaviour.kind === 'position') {
        onSuccess({
          coords: {
            latitude: 6.437,
            longitude: 3.473,
            accuracy: 35,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
            toJSON: () => ({}),
          },
          timestamp: Date.now(),
          toJSON: () => ({}),
        } as GeolocationPosition);
        return;
      }

      onError?.({
        code: behaviour.code,
        message: '',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError);
    },
  );

  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() },
  });

  return getCurrentPosition;
}

async function pressShowMe() {
  render(<NearbyProperties />);
  await userEvent.click(screen.getByRole('button', { name: /show properties near me/i }));
}

beforeEach(() => {
  findNearbyProperties.mockReset();
  findNearbyProperties.mockResolvedValue(initialNearbyState);
});

describe('before it is pressed', () => {
  it('asks the browser for nothing', () => {
    const getCurrentPosition = stubGeolocation({ kind: 'position' });
    render(<NearbyProperties />);

    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('claims nothing about what is nearby', () => {
    stubGeolocation({ kind: 'position' });
    render(<NearbyProperties />);

    expect(screen.queryByText(/No Livd properties within/i)).toBeNull();
    expect(screen.queryByText(/Location access is off/i)).toBeNull();
  });
});

describe('a refused permission is not an empty neighbourhood', () => {
  it('says location is off, and never that nothing is nearby', async () => {
    stubGeolocation({ kind: 'error', code: 1 });
    await pressShowMe();

    await waitFor(() => {
      expect(screen.getByText(/Location access is off/i)).toBeInTheDocument();
    });

    // The regression this whole file exists for.
    expect(screen.queryByText(/No Livd properties within/i)).toBeNull();
    expect(screen.queryByText(/Nothing found within/i)).toBeNull();
  });

  it('does not offer a retry that cannot work', async () => {
    // The switch is in browser settings. A retry button would fail identically
    // every time it was pressed.
    stubGeolocation({ kind: 'error', code: 1 });
    await pressShowMe();

    await waitFor(() => {
      expect(screen.getByText(/Location access is off/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    expect(screen.getByRole('link', { name: /search by address/i })).toBeInTheDocument();
  });

  it('never asks the server anything', async () => {
    stubGeolocation({ kind: 'error', code: 1 });
    await pressShowMe();

    await waitFor(() => {
      expect(screen.getByText(/Location access is off/i)).toBeInTheDocument();
    });
    expect(findNearbyProperties).not.toHaveBeenCalled();
  });
});

describe('a timeout is its own state', () => {
  it('says so, and offers a retry', async () => {
    stubGeolocation({ kind: 'error', code: 3 });
    await pressShowMe();

    await waitFor(() => {
      expect(screen.getByText(/taking too long/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/No Livd properties within/i)).toBeNull();
  });
});

describe('a browser without geolocation', () => {
  it('is told to search instead, not that the area is empty', async () => {
    stubGeolocation({ kind: 'absent' });
    await pressShowMe();

    await waitFor(() => {
      expect(screen.getByText(/cannot share a location/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/No Livd properties within/i)).toBeNull();
  });
});

describe('located, with nothing to show', () => {
  it('distinguishes an empty area from properties Livd cannot place', async () => {
    stubGeolocation({ kind: 'position' });
    findNearbyProperties.mockResolvedValue({
      status: 'ready',
      outcome: 'none_nearby',
      items: [],
      radiusMeters: 3000,
      unlocatableCount: 0,
      error: null,
    });
    await pressShowMe();

    await waitFor(() => {
      expect(screen.getByText(/No Livd properties within/i)).toBeInTheDocument();
    });
    // Names the radius it actually searched, rather than "a short walk".
    expect(screen.getByText(/3 km/)).toBeInTheDocument();
  });

  it('says when the absence is Livd’s gap rather than the area’s', async () => {
    // The state that would have surfaced the original bug in a minute.
    stubGeolocation({ kind: 'position' });
    findNearbyProperties.mockResolvedValue({
      status: 'ready',
      outcome: 'none_locatable',
      items: [],
      radiusMeters: 3000,
      unlocatableCount: 2,
      error: null,
    });
    await pressShowMe();

    await waitFor(() => {
      expect(screen.getByText(/no location recorded yet/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/2 properties/i)).toBeInTheDocument();
  });
});

describe('located, with results', () => {
  it('shows the property, its distance, and the radius searched', async () => {
    stubGeolocation({ kind: 'position' });
    findNearbyProperties.mockResolvedValue({
      status: 'ready',
      outcome: 'found',
      radiusMeters: 500,
      unlocatableCount: 0,
      error: null,
      items: [
        {
          slug: 'cardinal-court-abuja',
          name: 'Cardinal Court',
          context: 'Wuse 2',
          countryCode: 'NG',
          reviewCount: 11,
          verifiedCount: 2,
          recentReviewCount: 1,
          activityWindowDays: 180,
          overallScore: 73,
          lastReviewAt: '2026-08-01T00:00:00.000Z',
          distanceMeters: 320,
          isDemo: false,
        },
      ],
    });
    await pressShowMe();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Cardinal Court/ })).toBeInTheDocument();
    });

    expect(screen.getByText(/320 m away/)).toBeInTheDocument();
    expect(screen.getByText(/Within 500 m of you/)).toBeInTheDocument();
    // No widening notice: 500m was the first stage.
    expect(screen.queryByText(/Nothing was within 500/)).toBeNull();
  });

  it('discloses a widened radius rather than still calling it "near you"', async () => {
    stubGeolocation({ kind: 'position' });
    findNearbyProperties.mockResolvedValue({
      status: 'ready',
      outcome: 'found',
      radiusMeters: 3000,
      unlocatableCount: 0,
      error: null,
      items: [
        {
          slug: 'cardinal-court-abuja',
          name: 'Cardinal Court',
          context: 'Wuse 2',
          countryCode: 'NG',
          reviewCount: 11,
          verifiedCount: 0,
          recentReviewCount: 0,
          activityWindowDays: 180,
          overallScore: 73,
          lastReviewAt: null,
          distanceMeters: 2600,
          isDemo: false,
        },
      ],
    });
    await pressShowMe();

    await waitFor(() => {
      expect(screen.getByText(/Nothing was within 500 m/)).toBeInTheDocument();
    });
    expect(screen.getByText(/everything within 3 km/)).toBeInTheDocument();
  });
});
