/**
 * The app, against the file-backed local store.
 *
 * `npm run dev` uses whatever `.env.local` points at, which on a configured
 * machine is the real Supabase project — so exercising a signed-in flow means
 * signing in for real, and anything written lands in production. This starts
 * the same app with `LIVD_DATA_BACKEND=local`, where the sign-in form creates
 * an account and signs in directly (see `src/server/actions/auth.ts`) and every
 * row lives in `.data/`.
 *
 * The environment is set in this process rather than in a `.env` file on
 * purpose: `next dev` watches those and reloads them, so a file written here
 * would reach into any other dev server already running on this checkout.
 *
 *   node scripts/dev-local.mjs [--port 3100] [--dir <path>]
 *
 * `--dir` runs it from somewhere else, which is how a second one starts at all:
 * `next dev` refuses to run twice against the same directory, so exercising a
 * signed-in flow while an ordinary `npm run dev` is already up needs a worktree
 * of its own.
 *
 *   git worktree add --detach ../livd-local HEAD
 *   robocopy node_modules ../livd-local/node_modules /E /MT:16   # see below
 *   node scripts/dev-local.mjs --dir ../livd-local
 *
 * A copy rather than a symlink or a junction: Turbopack refuses a `node_modules`
 * link that resolves outside the project root, and fails the whole dev server
 * with `Symlink [project]/node_modules is invalid` rather than falling back.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const portFlag = args.indexOf('--port');
const port = portFlag === -1 ? '3100' : (args[portFlag + 1] ?? '3100');

const dirFlag = args.indexOf('--dir');
const cwd = dirFlag === -1 ? process.cwd() : (args[dirFlag + 1] ?? process.cwd());

// Next's own entry point, run by this Node rather than through `npx`. On
// Windows `npx` is a `.cmd`, and spawning one without a shell fails with
// EINVAL — while spawning it *with* a shell means quoting a path that contains
// a space, which this checkout's does.
const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');

const child = spawn(
  process.execPath,
  [nextBin, 'dev', '--port', port],
  {
    stdio: 'inherit',
    cwd,
    env: {
      ...process.env,
      LIVD_DATA_BACKEND: 'local',
      LIVD_SHOW_DEMO_DATA: 'true',
      // Neither is read by the local adapter, and leaving them set would make
      // `resolveDataBackend`'s "configured" branch look reachable in a stack
      // trace. Cleared so a mistake here fails loudly rather than reaching a
      // real project.
      NEXT_PUBLIC_SUPABASE_URL: '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
    },
  },
);

child.on('exit', (code) => process.exit(code ?? 0));
