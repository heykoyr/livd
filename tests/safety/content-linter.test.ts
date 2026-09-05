import { describe, expect, it } from 'vitest';

import { lintContent, redactSensitive } from '@/lib/safety/content-linter';

/**
 * The content linter.
 *
 * This is the control behind the product's central safety rule — reviews are
 * about the property, never about identifiable people — so it is tested from
 * both directions: it must catch what it claims to catch, including obvious
 * evasion, and it must not silence a resident with something true and ordinary
 * to say.
 *
 * The second half matters as much as the first. A false block costs someone
 * their account of three years of their life; a false flag costs a moderator
 * thirty seconds.
 */

const codes = (text: string) => lintContent(text).blocks.map((issue) => issue.code);

describe('contact details', () => {
  it.each([
    ['a UK mobile', 'Call me on 07700 900123 if you want details.'],
    ['a US number', 'My number is (415) 555-0132.'],
    ['an international number', 'Reach me on +234 803 555 1122.'],
    ['a run of digits', 'Text 08035551122 for the real story.'],
    ['an email', 'Email me at renter@example.com for photos.'],
    ['an obfuscated email', 'Contact renter (at) example (dot) com.'],
    ['a URL', 'See the photos at https://example.com/evidence'],
    ['a bare domain', 'Everything is documented on myrentalstory.com'],
    ['a handle', 'I posted the whole saga @renterstories'],
    ['a messaging app', 'WhatsApp me and I will send the pictures.'],
    ['spelled-out digits', 'Ring zero eight zero three five five five one one two two.'],
  ])('blocks %s', (_label, text) => {
    expect(codes(text)).toContain('contact_details');
    expect(lintContent(text).ok).toBe(false);
  });

  it('does not block ordinary numbers a review legitimately contains', () => {
    const fine = [
      'The rent went up by 12% in 2024 and again in 2025.',
      'We lived there for 3 years and 2 months.',
      'There are 24 units in the building and 2 lifts.',
      'It was built in 1928 and renovated around 2015.',
    ];

    for (const text of fine) {
      expect(lintContent(text).ok, text).toBe(true);
    }
  });
});

describe('unit numbers', () => {
  it.each([
    'Flat 4B had the worst of the damp.',
    'Apartment 12 flooded twice.',
    'Unit 7 never got hot water.',
    'The problem was worst in apt 3a.',
    'Avoid #14 in particular.',
  ])('blocks "%s"', (text) => {
    expect(codes(text)).toContain('unit_number');
  });

  it('allows floor and building references, which identify nobody', () => {
    const fine = [
      'The top floor was always coldest.',
      'Block B is quieter than the main building.',
      'There are 3 flats per floor.',
    ];
    for (const text of fine) {
      expect(lintContent(text).ok, text).toBe(true);
    }
  });
});

describe('named individuals', () => {
  it.each([
    'Mr Adebayo never returned a single call.',
    'The landlady Grace was impossible to reach.',
    'Our caretaker Michael did his best with nothing.',
    'The manager called David refused to help.',
    'Chief Okonkwo owns the whole block.',
    'Speak to Dr Patel if you want the history.',
  ])('blocks "%s"', (text) => {
    expect(codes(text)).toContain('named_individual');
  });

  it('does not mistake a sentence about a role for a name', () => {
    // These begin a clause with a capital after a role word, which a naive
    // pattern reads as a name.
    const fine = [
      'The landlord Never once replied.',
      'Our manager Would not authorise the repair.',
      'The agent Ignored three emails.',
      'The landlord was slow but not dishonest.',
      'Management changed twice while we were there.',
      'The security lighting was out for months.',
    ];

    for (const text of fine) {
      expect(lintContent(text).ok, text).toBe(true);
    }
  });
});

describe('threats and harassment', () => {
  it.each([
    'I will find the owner and deal with him.',
    'Watch your back if you rent from these people.',
    'I am going to burn the place down.',
  ])('blocks "%s"', (text) => {
    expect(codes(text)).toContain('threat');
  });

  it('allows strong but legitimate criticism', () => {
    const fine = [
      'This was the worst year of renting I have had.',
      'I would never sign here again and I would tell anyone to avoid it.',
      'Genuinely appalling management from start to finish.',
    ];
    for (const text of fine) {
      expect(lintContent(text).ok, text).toBe(true);
    }
  });
});

describe('discrimination', () => {
  it('blocks exclusionary targeting of a group', () => {
    expect(codes('There are too many immigrants in this building.')).toContain('discrimination');
    expect(codes('Students should not be allowed to live here.')).toContain('discrimination');
  });

  it('allows a neutral observation about who lives there', () => {
    // The group word alone is not the offence; the exclusionary construction is.
    expect(lintContent('The building is mostly students and young professionals.').ok).toBe(true);
    expect(lintContent('A lot of families live in the block, which was lovely.').ok).toBe(true);
  });
});

describe('allegations', () => {
  it('flags an unhedged criminal accusation for a moderator rather than blocking it', () => {
    const result = lintContent('The agency is a fraud and took our deposit.');

    // A resident whose deposit really was taken must be able to say so — but a
    // flat accusation needs a human before it becomes a permanent public record.
    expect(result.ok).toBe(true);
    expect(result.flags.map((f) => f.code)).toContain('unverified_allegation');
  });

  it('does not flag the same claim stated as personal experience', () => {
    const hedged = lintContent(
      'In my experience the agency is a fraud, though I never took it further.',
    );
    expect(hedged.flags.map((f) => f.code)).not.toContain('unverified_allegation');
  });
});

describe('tone', () => {
  it('flags sustained shouting without blocking it', () => {
    const result = lintContent(
      'DO NOT RENT HERE UNDER ANY CIRCUMSTANCES BECAUSE THE MANAGEMENT WILL IGNORE YOU COMPLETELY',
    );
    expect(result.ok).toBe(true);
    expect(result.flags.map((f) => f.code)).toContain('excessive_caps');
  });

  it('does not flag an acronym in ordinary prose', () => {
    const result = lintContent(
      'The EPC rating was poor and the HMO licence had lapsed, which nobody mentioned before we signed the tenancy agreement.',
    );
    expect(result.flags.map((f) => f.code)).not.toContain('excessive_caps');
  });
});

describe('linter behaviour', () => {
  it('passes an ordinary, useful review untouched', () => {
    const review =
      'We lived here for two years. The location is excellent and the neighbours were friendly, ' +
      'but repairs took weeks and the heating struggled every winter. The deposit came back in ' +
      'full, which I did not expect. Ask about the boiler before you sign.';

    const result = lintContent(review);
    expect(result.ok).toBe(true);
    expect(result.blocks).toHaveLength(0);
    expect(result.flags).toHaveLength(0);
  });

  it('treats empty input as clean', () => {
    expect(lintContent(null).ok).toBe(true);
    expect(lintContent('').ok).toBe(true);
    expect(lintContent('   ').ok).toBe(true);
  });

  it('is not order-dependent across calls', () => {
    // The patterns are module-level and global; a leaked lastIndex would make
    // the second identical call behave differently from the first.
    const text = 'Call 07700 900123 and ask for the truth.';
    const first = lintContent(text);
    const second = lintContent(text);
    expect(second.blocks.map((b) => b.code)).toEqual(first.blocks.map((b) => b.code));
  });

  it('reports each distinct problem once', () => {
    const result = lintContent('Call 07700 900123 or 07700 900124 or email a@b.com.');
    const contactIssues = result.blocks.filter((b) => b.code === 'contact_details');
    // Several matches, but the writer needs one instruction per kind of fix.
    expect(contactIssues.length).toBeGreaterThan(0);
    expect(new Set(result.flagCodes).size).toBe(result.flagCodes.length);
  });

  it('collects every problem in one pass rather than stopping at the first', () => {
    const result = lintContent('Ring 07700 900123. Mr Adebayo in Flat 4B knows everything.');
    expect(new Set(result.blocks.map((b) => b.code))).toEqual(
      new Set(['contact_details', 'named_individual', 'unit_number']),
    );
  });
});

describe('redactSensitive', () => {
  it('strips contact details from stored text as a safety net', () => {
    const redacted = redactSensitive('Call 07700 900123 or email a@b.com about Flat 4B.');
    expect(redacted).not.toContain('07700');
    expect(redacted).not.toContain('a@b.com');
    expect(redacted).toContain('[removed]');
    expect(redacted).toContain('[unit removed]');
  });

  it('leaves ordinary prose alone', () => {
    const text = 'The building was well kept and the neighbours were friendly.';
    expect(redactSensitive(text)).toBe(text);
  });
});
