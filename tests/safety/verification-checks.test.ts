import { describe, expect, it } from 'vitest';

import {
  VERIFICATION_LIMITS,
  isBlocked,
  runVerificationChecks,
  type VerificationContext,
} from '@/lib/safety/verification-checks';

/**
 * Automated checks on a verification submission.
 *
 * Two failure modes matter here and they pull in opposite directions. Letting
 * a fabricated tenancy through inflates a score with a weight of 1.8 and puts
 * a lie in front of someone choosing where to live. Refusing a real one takes
 * away a resident's ability to be believed, silently, with no way to argue.
 *
 * So the tests are weighted toward what the checks must *not* do: nothing here
 * approves anything, and only the handful of cases that cannot be legitimate
 * are allowed to block.
 */

const NOW = new Date('2026-06-15T12:00:00.000Z');

function context(overrides: Partial<VerificationContext> = {}): VerificationContext {
  return {
    review: { movedInMonth: '2022-03-01', movedOutMonth: '2024-05-01', authorId: 'user-1' },
    property: { yearBuilt: 1998 } as VerificationContext['property'],
    submitterCreatedAt: '2022-01-01T00:00:00.000Z',
    submitterOwnsProperty: false,
    priorSubmitterIds: [],
    recentSubmissionCount: 1,
    file: { type: 'image/jpeg', bytes: 900_000 },
    now: NOW,
    ...overrides,
  };
}

const codes = (c: VerificationContext) => runVerificationChecks(c).map((x) => x.code);

describe('an ordinary submission', () => {
  it('produces nothing at all', () => {
    expect(runVerificationChecks(context())).toEqual([]);
  });

  it('is not blocked', () => {
    expect(isBlocked(runVerificationChecks(context()))).toBe(false);
  });

  it('accepts every format a phone camera or a letting agent produces', () => {
    for (const type of VERIFICATION_LIMITS.acceptedTypes) {
      expect(codes(context({ file: { type, bytes: 500_000 } }))).toEqual([]);
    }
  });

  it('says nothing about a current resident, who has no move-out date', () => {
    expect(codes(context({ review: { movedInMonth: '2025-01-01', movedOutMonth: null, authorId: 'user-1' } }))).toEqual(
      [],
    );
  });

  it('says nothing when the property has no recorded build year', () => {
    expect(
      codes(context({ property: { yearBuilt: null } as VerificationContext['property'] })),
    ).toEqual([]);
  });
});

describe('the file', () => {
  it('blocks an empty upload', () => {
    const found = runVerificationChecks(context({ file: { type: 'image/png', bytes: 0 } }));
    expect(found.map((c) => c.code)).toContain('file_empty');
    expect(isBlocked(found)).toBe(true);
  });

  it('blocks something too large to be a photograph of a document', () => {
    const found = runVerificationChecks(
      context({ file: { type: 'image/png', bytes: VERIFICATION_LIMITS.maxBytes + 1 } }),
    );
    expect(found.map((c) => c.code)).toContain('file_too_large');
    expect(isBlocked(found)).toBe(true);
  });

  it('blocks a format that is not a document', () => {
    const found = runVerificationChecks(
      context({ file: { type: 'application/zip', bytes: 100 } }),
    );
    expect(found.map((c) => c.code)).toContain('unsupported_file_type');
    expect(isBlocked(found)).toBe(true);
  });

  it('allows a file exactly on the limit', () => {
    expect(
      codes(context({ file: { type: 'application/pdf', bytes: VERIFICATION_LIMITS.maxBytes } })),
    ).toEqual([]);
  });
});

describe('the same document used twice', () => {
  it('notes another account having submitted the identical file', () => {
    const found = runVerificationChecks(context({ priorSubmitterIds: ['user-2', 'user-3'] }));
    const reuse = found.find((c) => c.code === 'evidence_reused_by_another_account');

    expect(reuse).toBeDefined();
    expect(reuse!.detail).toContain('2 other accounts');
  });

  it('does not block it, because housemates share a tenancy agreement', () => {
    const found = runVerificationChecks(context({ priorSubmitterIds: ['user-2'] }));
    expect(isBlocked(found)).toBe(false);
  });

  it('treats a resubmission by the same person as unremarkable', () => {
    const found = runVerificationChecks(context({ priorSubmitterIds: ['user-1'] }));

    expect(found.map((c) => c.code)).toEqual(['evidence_already_submitted']);
    expect(isBlocked(found)).toBe(false);
  });

  it('counts only the other accounts when the author is among them', () => {
    const reuse = runVerificationChecks(
      context({ priorSubmitterIds: ['user-1', 'user-2'] }),
    ).find((c) => c.code === 'evidence_reused_by_another_account');

    expect(reuse!.detail).toContain('1 other account');
  });
});

describe('who is asking', () => {
  it('blocks the owner of the property from verifying themselves as a resident', () => {
    const found = runVerificationChecks(context({ submitterOwnsProperty: true }));

    expect(found.map((c) => c.code)).toContain('submitter_owns_the_property');
    expect(isBlocked(found)).toBe(true);
  });

  it('notes an account submitting unusually often, without blocking it', () => {
    const found = runVerificationChecks(
      context({ recentSubmissionCount: VERIFICATION_LIMITS.recentSubmissionCeiling + 1 }),
    );

    expect(found.map((c) => c.code)).toContain('many_recent_submissions');
    expect(isBlocked(found)).toBe(false);
  });

  it('leaves someone at the ceiling alone', () => {
    expect(
      codes(context({ recentSubmissionCount: VERIFICATION_LIMITS.recentSubmissionCeiling })),
    ).toEqual([]);
  });
});

describe('whether the claimed tenancy holds together', () => {
  it('notes a tenancy that starts before the building did', () => {
    const found = runVerificationChecks(
      context({
        review: { movedInMonth: '1990-06-01', movedOutMonth: '1995-01-01', authorId: 'user-1' },
      }),
    );

    const check = found.find((c) => c.code === 'tenancy_predates_the_building');
    expect(check).toBeDefined();
    expect(check!.detail).toContain('1998');
  });

  it('allows a tenancy beginning in the year the building went up', () => {
    expect(
      codes(
        context({
          review: { movedInMonth: '1998-02-01', movedOutMonth: '2001-01-01', authorId: 'user-1' },
          // The default fixture registers in 2022, which would correctly trip
          // the "account created after the tenancy ended" note and tell us
          // nothing about the build year.
          submitterCreatedAt: '1999-01-01T00:00:00.000Z',
        }),
      ),
    ).toEqual([]);
  });

  it('notes a move-in month that has not happened yet', () => {
    expect(
      codes(context({ review: { movedInMonth: '2027-01-01', movedOutMonth: null, authorId: 'user-1' } })),
    ).toContain('tenancy_in_the_future');
  });

  it('notes an account created after the tenancy ended', () => {
    expect(codes(context({ submitterCreatedAt: '2025-01-01T00:00:00.000Z' }))).toContain(
      'account_created_after_move_out',
    );
  });

  it('says nothing when the account existed during the tenancy', () => {
    expect(codes(context({ submitterCreatedAt: '2023-01-01T00:00:00.000Z' }))).toEqual([]);
  });

  it('never blocks on a date, only notes it', () => {
    const found = runVerificationChecks(
      context({
        review: { movedInMonth: '1900-01-01', movedOutMonth: '2027-01-01', authorId: 'user-1' },
        submitterCreatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );

    expect(found.length).toBeGreaterThan(0);
    expect(isBlocked(found)).toBe(false);
  });
});

describe('the order a moderator reads them in', () => {
  it('puts anything blocking first', () => {
    const found = runVerificationChecks(
      context({
        submitterOwnsProperty: true,
        priorSubmitterIds: ['user-9'],
        recentSubmissionCount: 99,
      }),
    );

    expect(found[0]!.severity).toBe('blocking');
    expect(found.length).toBeGreaterThan(1);
  });
});
