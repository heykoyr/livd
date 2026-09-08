import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The verification step, as a person meets it.
 *
 * Browser testing established that these states render; this establishes that
 * they keep rendering. The two properties worth locking down are the ones a
 * refactor would quietly break:
 *
 *   - every failure has a way forward, so nobody is ever trapped on this screen
 *   - no failure reveals how far away the reading was
 *
 * The second matters more than it looks. "You are 214 metres outside the area"
 * is a range-finder: enough refusals like that and a building's position is
 * known precisely, which is the opposite of what this feature is for.
 */

const verifyPropertyLocation = vi.fn();

vi.mock('@/server/actions/property-verification', () => ({
  verifyPropertyLocation: (...args: unknown[]) => verifyPropertyLocation(...args),
}));

const { VerifyLocation } = await import('@/components/property/verify-location');

/** Replaces the browser's geolocation with a scripted one. */
function stubGeolocation(
  behaviour:
    | { kind: 'position'; latitude: number; longitude: number; accuracy: number }
    | { kind: 'error'; code: number },
) {
  const getCurrentPosition = vi.fn(
    (
      onSuccess: PositionCallback,
      onError?: PositionErrorCallback | null,
    ) => {
      if (behaviour.kind === 'position') {
        onSuccess({
          coords: {
            latitude: behaviour.latitude,
            longitude: behaviour.longitude,
            accuracy: behaviour.accuracy,
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

function renderStep(overrides: Partial<Parameters<typeof VerifyLocation>[0]> = {}) {
  return render(
    <VerifyLocation
      propertyId="property-1"
      propertyName="Ashfield Court"
      verified={false}
      onVerified={vi.fn()}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  verifyPropertyLocation.mockReset();
});

describe('before anything is pressed', () => {
  it('asks for no location on mount', () => {
    const getCurrentPosition = stubGeolocation({
      kind: 'position',
      latitude: 51.546,
      longitude: -0.052,
      accuracy: 20,
    });

    renderStep();

    // The permission prompt belongs to a deliberate action, not to arriving on
    // a screen. A product that asks on mount has told the reader it is
    // watching before it has told them why.
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('says what the location is for and what happens to it, before the prompt', () => {
    stubGeolocation({ kind: 'position', latitude: 51.546, longitude: -0.052, accuracy: 20 });
    renderStep();

    expect(screen.getByText(/never shown publicly/i)).toBeInTheDocument();
    expect(screen.getByText(/never shared with the property owner/i)).toBeInTheDocument();
    // "not stored" deliberately appears twice — once in the visible card and
    // once in the screen-reader description, so the promise is not something
    // only a sighted reader is told.
    expect(screen.getAllByText(/not stored/i).length).toBeGreaterThanOrEqual(2);
  });

  it('never claims that being at a property proves living there', () => {
    stubGeolocation({ kind: 'position', latitude: 51.546, longitude: -0.052, accuracy: 20 });
    const { container } = renderStep();

    expect(
      screen.getByText(/confirms you are at the property, not that you live here/i),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/we know you live here/i);
    expect(container.textContent).not.toMatch(/proves? (that )?you live/i);
  });
});

describe('a successful check', () => {
  it('reports the property verified and hands the id back', async () => {
    stubGeolocation({ kind: 'position', latitude: 51.546, longitude: -0.052, accuracy: 18 });
    verifyPropertyLocation.mockResolvedValue({
      status: 'verified',
      error: null,
      verificationId: 'verify-abc',
      failureReason: null,
    });

    const onVerified = vi.fn();
    renderStep({ onVerified });

    await userEvent.click(screen.getByRole('button', { name: /verify location/i }));

    await waitFor(() => expect(onVerified).toHaveBeenCalledWith('verify-abc'));
    expect(await screen.findByText(/property verified/i)).toBeInTheDocument();
  });

  it('announces the result politely rather than interrupting', async () => {
    stubGeolocation({ kind: 'position', latitude: 51.546, longitude: -0.052, accuracy: 18 });
    verifyPropertyLocation.mockResolvedValue({
      status: 'verified',
      error: null,
      verificationId: 'verify-abc',
      failureReason: null,
    });

    renderStep();
    await userEvent.click(screen.getByRole('button', { name: /verify location/i }));

    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });
});

describe('every failure leaves a way forward', () => {
  const cases: Array<[string, () => void, RegExp]> = [
    [
      'permission refused',
      () => stubGeolocation({ kind: 'error', code: 1 }),
      /location access is off/i,
    ],
    [
      'no fix available',
      () => stubGeolocation({ kind: 'error', code: 2 }),
      /could not get your location/i,
    ],
    [
      'the device took too long',
      () => stubGeolocation({ kind: 'error', code: 3 }),
      /took too long/i,
    ],
  ];

  it.each(cases)('%s', async (_name, setup, expected) => {
    setup();
    renderStep();

    await userEvent.click(screen.getByRole('button', { name: /verify location/i }));

    expect(await screen.findByText(expected)).toBeInTheDocument();
    // The retry is the same control, relabelled — never a dead end.
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('handles a browser with no geolocation at all', async () => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
    renderStep();

    await userEvent.click(screen.getByRole('button', { name: /verify location/i }));

    expect(await screen.findByText(/cannot share a location/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

describe('a server refusal', () => {
  const refuse = async (failureReason: string) => {
    stubGeolocation({ kind: 'position', latitude: 51.546, longitude: -0.052, accuracy: 20 });
    verifyPropertyLocation.mockResolvedValue({
      status: 'failed',
      error: null,
      verificationId: null,
      failureReason,
    });

    const view = renderStep();
    await userEvent.click(screen.getByRole('button', { name: /verify location/i }));
    return view;
  };

  it('explains being outside the area without saying by how much', async () => {
    const { container } = await refuse('outside_area');

    expect(await screen.findByText(/outside the verification area/i)).toBeInTheDocument();
    expect(screen.getByText(/move closer to the property/i)).toBeInTheDocument();

    // No distance, no radius, no coordinate. A refusal that reports the miss is
    // a range-finder for the building's true position.
    expect(container.textContent).not.toMatch(/\d+\s*(m|metres|meters|km|ft|mi)\b/i);
    expect(container.textContent).not.toMatch(/radius/i);
  });

  it('is vague about the anti-abuse rule, on purpose', async () => {
    const { container } = await refuse('implausible_movement');

    expect(await screen.findByText(/could not verify this location/i)).toBeInTheDocument();
    // Naming the rule would tell somebody how to arrange the next attempt so it
    // does not trip.
    expect(container.textContent).not.toMatch(/speed|travel|km\/h|impossible/i);
  });

  it('tells someone at an unmappable property that their review is unaffected', async () => {
    await refuse('property_has_no_coordinates');

    expect(await screen.findByText(/cannot be verified yet/i)).toBeInTheDocument();
    expect(screen.getByText(/your review is published without a verification badge/i))
      .toBeInTheDocument();
  });

  it('never renders a coordinate, whatever the outcome', async () => {
    const { container } = await refuse('outside_area');

    expect(container.textContent).not.toContain('51.546');
    expect(container.textContent).not.toContain('-0.052');
    expect(container.textContent?.toLowerCase()).not.toContain('latitude');
    expect(container.textContent?.toLowerCase()).not.toContain('longitude');
  });
});

describe('when the caller already holds a verification', () => {
  it('does not ask again', () => {
    const getCurrentPosition = stubGeolocation({
      kind: 'position',
      latitude: 51.546,
      longitude: -0.052,
      accuracy: 20,
    });

    renderStep({ verified: true });

    expect(screen.getByText(/property verified/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /verify location/i })).not.toBeInTheDocument();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });
});
