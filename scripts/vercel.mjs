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
 */

const preload = fileURLToPath(new URL('./vercel-ascii-hostname.cjs', import.meta.url));

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['--no-install', 'vercel', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${JSON.stringify(preload)}`.trim(),
    },
  },
);

process.exit(result.status ?? 1);
