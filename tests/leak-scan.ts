/**
 * Scanning a serialised payload for something that must not be in it.
 *
 * `expect(JSON.stringify(row)).not.toContain('51.546')` is the right shape of
 * question: it does not care which field a leaked value hid in, or what the
 * field was called, so it still fails when somebody smuggles a coordinate into
 * a note or a nested object. That is why several of the safety tests ask it.
 *
 * It has one blind spot, and the blind spot is the clock. An ISO timestamp is
 * a run of digits with a decimal point in it, so it can *contain* the number
 * being searched for by coincidence:
 *
 *   2026-09-20T00:11:23.408Z   contains "23.4"
 *   2026-09-20T10:20:51.546Z   contains "51.546"
 *
 * Both are the second and the millisecond a row happened to be written in, and
 * neither is a leak. The failure is rare — the first needs the 23rd second and
 * a millisecond in the 400s — which is the worst frequency to have: often
 * enough to fail a suite now and then, rarely enough that a re-run always
 * looks like it fixed it. It cost a real run on 2026-09-19, reported as
 * "expected ... not to contain '23.4'" against a row that held no accuracy at
 * all.
 *
 * So blank the timestamps before scanning, and only the timestamps: the
 * pattern is anchored to the quotes around a whole JSON string value, so a
 * field holding "51.546", or prose with a timestamp inside it, is left alone
 * and still fails the scan.
 *
 * Numbers are safe as they are. An epoch millisecond is an integer, and an
 * integer cannot contain a decimal point.
 */

const ISO_TIMESTAMP = /"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z"/g;

/** The same JSON with every whole ISO timestamp value replaced by a marker. */
export function withoutTimestamps(serialised: string): string {
  return serialised.replace(ISO_TIMESTAMP, '"<timestamp>"');
}
