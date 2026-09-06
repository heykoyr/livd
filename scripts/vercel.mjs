import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Runs the Vercel CLI with an ASCII-safe hostname.
 *
 * See scripts/vercel-ascii-hostname.cjs — without the preload, every Vercel
 * command on this machine fails with a ByteString error before it starts,
 * because the machine's name contains characters that cannot go in an HTTP
 * header.
 *
 *   npm run vercel -- whoami
 *   npm run vercel -- link
 *   npm run vercel -- deploy --prod
 *
 * `shell: true` is required, not incidental: on Windows the CLI is `npx.cmd`,
 * and since the fix for CVE-2024-27980 Node refuses to spawn a `.cmd` file
 * without a shell. Without it every command exits 1 with no output at all.
 */

const preload = fileURLToPath(new URL('./vercel-ascii-hostname.cjs', import.meta.url));

/** Quote anything a shell would otherwise split or interpret. */
function quote(arg) {
  return /^[A-Za-z0-9._\/=@:-]+$/.test(arg) ? arg : JSON.stringify(arg);
}

const command = ['npx', '--no-install', 'vercel', ...process.argv.slice(2)]
  .map(quote)
  .join(' ');

const result = spawnSync(command, {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${JSON.stringify(preload)}`.trim(),
  },
});

process.exit(result.status ?? 1);
