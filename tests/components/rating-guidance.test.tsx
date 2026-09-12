import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CategoriesStep, OverallStep } from '@/app/review/steps';
import { emptyDraft } from '@/app/review/wizard-types';
import { EditReviewForm } from '@/app/account/reviews/[id]/edit/edit-review-form';

// The correction form imports the Server Action, which drags the repository
// and the safety pipeline across the boundary. The form is what is under test
// here, not what it posts to.
vi.mock('@/server/actions/reviews', () => ({ correctReview: vi.fn() }));

/**
 * What the numbers mean, on every screen that asks for one.
 *
 * The wizard used to explain the scale once, on the overall screen, where
 * each button carries its word underneath. The next screen asks for up to
 * twelve more ratings using the compact scale, whose buttons are too small
 * for a word — so a reviewer was entering most of their ratings against bare
 * digits, with the only explanation one screen behind them.
 *
 * That is not a cosmetic gap. A reviewer who guesses the direction wrong
 * inverts ratings that feed a public score, and nothing downstream can detect
 * it.
 *
 * These tests assert the guarantee rather than the implementation: on a
 * screen where a 1-5 rating is assigned, the words for 1 and 5 are on it.
 *
 * The correction form is held to the same rule. It was the obvious place for
 * the gap to reappear — a second screen that assigns the same ratings, written
 * long after the first, while the fix lived in the wizard.
 */

const draft = emptyDraft({
  id: 'p1',
  slug: 'test-property',
  name: 'Test Property',
  context: 'London, United Kingdom',
  countryCode: 'GB',
  isDemo: false,
  canVerifyLocation: false,
});

const noop = () => {};

// Computed once, outside the component: a clock read during render is exactly
// what `react-hooks/purity` exists to stop, and a fixture has no business
// producing a different deadline on every re-render.
const CLOSES_AT = new Date(Date.now() + 3_600_000).toISOString();

/** A review published at 2/5, still inside its correction window. */
function CorrectionForm() {
  return (
    <EditReviewForm
      reviewId="r1"
      body="A body long enough to be a real review rather than a placeholder string."
      wouldRecommend={false}
      overallRating={2}
      categoryRatings={[{ categoryKey: 'noise', rating: 2 }]}
      residencyStatus="former"
      tenureMonths={18}
      verificationLevel="unverified"
      countryCode="GB"
      propertySlug="test-property"
      closesAt={CLOSES_AT}
      remainingLabel="1 hour"
    />
  );
}

describe('rating guidance', () => {
  it('names both ends of the scale on the overall step', () => {
    render(<OverallStep draft={draft} update={noop} error={null} />);

    const group = screen.getByRole('group', { name: /overall experience/i });
    expect(within(group).getAllByText('Poor').length).toBeGreaterThan(0);
    expect(within(group).getAllByText('Excellent').length).toBeGreaterThan(0);
  });

  it('keeps the scale on the category step, where the buttons carry no words', () => {
    render(<CategoriesStep draft={draft} update={noop} error={null} />);

    const legend = screen.getByText('Scale').closest('p');
    expect(legend).not.toBeNull();

    // Every one of the five, in order, so a reversed or truncated legend
    // fails here rather than in a reviewer's head.
    const text = legend?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('1 Poor');
    expect(text).toContain('2 Weak');
    expect(text).toContain('3 Mixed');
    expect(text).toContain('4 Good');
    expect(text).toContain('5 Excellent');
  });

  it('keeps the scale on the correction form, which assigns the same ratings', () => {
    render(<CorrectionForm />);

    const legend = screen.getByText('Scale').closest('p');
    const text = legend?.textContent?.replace(/\s+/g, ' ') ?? '';

    expect(text).toContain('1 Poor');
    expect(text).toContain('5 Excellent');
  });

  it('starts the correction from the rating the review was published with', () => {
    render(<CorrectionForm />);

    // Not blank, and not reset to a default: a correction begins from what is
    // on the record, so somebody changing one category does not silently
    // re-answer the rest.
    const overall = screen.getByRole('group', { name: /overall/i });
    const chosen = within(overall).getByRole('radio', { name: /2\s*Weak/i });
    expect((chosen as HTMLInputElement).checked).toBe(true);
  });

  it('offers every rating on the category step as a labelled control', () => {
    render(<CategoriesStep draft={draft} update={noop} error={null} />);

    const groups = screen.getAllByRole('group');
    expect(groups.length).toBeGreaterThan(3);

    // The compact scale hides its words visually but must keep them for a
    // screen reader, or the legend is the only thing carrying the meaning.
    const first = groups[0];
    expect(first).toBeDefined();
    expect(within(first!).getByRole('radio', { name: /1\s*Poor/i })).toBeTruthy();
    expect(within(first!).getByRole('radio', { name: /5\s*Excellent/i })).toBeTruthy();
  });
});
