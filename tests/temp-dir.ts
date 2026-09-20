import { rm } from 'node:fs/promises';

/**
 * Removing a temporary directory, on a filesystem that may not be ready.
 *
 * Twenty-three suites run the file-backed store in a directory of their own:
 * `mkdtemp`, `chdir`, and a `rm` between tests and at the end. On Windows that
 * `rm` fails now and then —
 *
 *   ENOTEMPTY: directory not empty, rmdir 'C:\...\livd-neighbourhoods-UoJskX\.data'
 *
 * — which reads as a test tearing down badly, and is not. The directory really
 * is empty by then. Something outside the process still holds a file inside it
 * for a moment longer: a scanner, the indexer, or the OS simply not having
 * released the entry yet. It lets go milliseconds later. Nothing in the
 * application writes without awaiting the write, so there is no straggler of
 * ours to wait for — `mutate` awaits `persist`, every caller awaits `mutate`.
 *
 * It surfaced as one failed file in one run and one failed test in the next,
 * with everything green on the third, which is the most expensive kind of
 * failure: it makes a suite look unreliable and trains people to re-run rather
 * than read.
 *
 * `rm` already knows how to wait. `maxRetries` retries exactly this class of
 * error — EBUSY, EMFILE, ENFILE, ENOTEMPTY, EPERM — backing off a little
 * further each time. Ten tries from 50ms is about three seconds of patience in
 * the worst case and nothing at all in the ordinary one, where the first
 * attempt succeeds.
 *
 * Measured rather than assumed: holding a handle to a file in the directory for
 * 120ms fails 25 out of 25 removals as the suites used to call it, and 0 out of
 * 25 through this.
 */
export function removeTree(path: string): Promise<void> {
  return rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
