import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DatesStep } from '@/app/review/steps';
import { emptyDraft, type WizardDraft } from '@/app/review/wizard-types';

/**
 * Regression test for the month/year field.
 *
 * The original implementation derived both selects from the committed ISO date.
 * Choosing a month while the year was still empty committed `null`, the field
 * re-rendered from that null, and the month the user had just chosen was
 * discarded. The same happened in reverse. The result was a date that could
 * never be entered and a wizard that could never be completed — and it was
 * invisible in code review, in typechecking and in a static screenshot.
 *
 * These tests drive the control the way a person does.
 */

function Harness({ residency }: { residency: 'current' | 'former' }) {
  const [draft, setDraft] = useState<WizardDraft>(() => ({
    ...emptyDraft(null),
    residencyStatus: residency,
  }));

  return (
    <>
      <DatesStep
        draft={draft}
        update={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        error={null}
      />
      <output data-testid="moved-in">{draft.movedInMonth ?? 'null'}</output>
      <output data-testid="moved-out">{draft.movedOutMonth ?? 'null'}</output>
    </>
  );
}

describe('DatesStep month/year field', () => {
  it('keeps the month after a year is chosen, in either order', async () => {
    const user = userEvent.setup();
    render(<Harness residency="current" />);

    const month = screen.getByLabelText('Month');
    const year = screen.getByLabelText('Year');

    await user.selectOptions(month, '03');
    // The month must survive being chosen first — this is what regressed.
    expect(month).toHaveValue('03');

    await user.selectOptions(year, '2022');
    expect(month).toHaveValue('03');
    expect(year).toHaveValue('2022');
    expect(screen.getByTestId('moved-in')).toHaveTextContent('2022-03-01');
  });

  it('keeps the year after a month is chosen', async () => {
    const user = userEvent.setup();
    render(<Harness residency="current" />);

    const month = screen.getByLabelText('Month');
    const year = screen.getByLabelText('Year');

    await user.selectOptions(year, '2021');
    expect(year).toHaveValue('2021');

    await user.selectOptions(month, '11');
    expect(year).toHaveValue('2021');
    expect(screen.getByTestId('moved-in')).toHaveTextContent('2021-11-01');
  });

  it('commits nothing until both halves are present', async () => {
    const user = userEvent.setup();
    render(<Harness residency="current" />);

    await user.selectOptions(screen.getByLabelText('Month'), '07');
    expect(screen.getByTestId('moved-in')).toHaveTextContent('null');
  });

  it('shows a move-out field only for a former resident', () => {
    const { unmount } = render(<Harness residency="current" />);
    expect(screen.queryByText('Moved out')).not.toBeInTheDocument();
    unmount();

    render(<Harness residency="former" />);
    expect(screen.getByText('Moved out')).toBeInTheDocument();
  });

  it('collects both dates independently for a former resident', async () => {
    const user = userEvent.setup();
    render(<Harness residency="former" />);

    const months = screen.getAllByLabelText('Month');
    const years = screen.getAllByLabelText('Year');

    await user.selectOptions(months[0]!, '01');
    await user.selectOptions(years[0]!, '2020');
    await user.selectOptions(months[1]!, '09');
    await user.selectOptions(years[1]!, '2023');

    expect(screen.getByTestId('moved-in')).toHaveTextContent('2020-01-01');
    expect(screen.getByTestId('moved-out')).toHaveTextContent('2023-09-01');
  });

  it('pins every date to the first of the month', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();

    function Spy() {
      const [draft, setDraft] = useState<WizardDraft>(() => ({
        ...emptyDraft(null),
        residencyStatus: 'current' as const,
      }));
      return (
        <DatesStep
          draft={draft}
          update={(patch) => {
            spy(patch);
            setDraft((current) => ({ ...current, ...patch }));
          }}
          error={null}
        />
      );
    }

    render(<Spy />);
    await user.selectOptions(screen.getByLabelText('Month'), '05');
    await user.selectOptions(screen.getByLabelText('Year'), '2024');

    const committed = spy.mock.calls
      .map(([patch]) => (patch as { movedInMonth?: string | null }).movedInMonth)
      .filter((value): value is string => typeof value === 'string');

    expect(committed.length).toBeGreaterThan(0);
    for (const date of committed) {
      // Day precision would let a tenancy be matched to a letting record.
      expect(date).toMatch(/^\d{4}-\d{2}-01$/);
    }
  });
});
