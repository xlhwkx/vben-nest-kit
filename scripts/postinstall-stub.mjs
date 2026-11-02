/**
 * Root postinstall: stub workspace packages for local monorepo DX.
 * Filtered CI installs (e.g. `--filter @qingzhan/server...`) leave many
 * packages without node_modules; set IGNORE_STUB=1 to skip stub there.
 */
import { spawnSync } from 'node:child_process';

if (process.env.IGNORE_STUB === '1') {
  console.log('[postinstall] IGNORE_STUB=1 — skip workspace stub');
  process.exit(0);
}

const result = spawnSync('pnpm', ['-r', 'run', '--if-present', 'stub'], {
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status === null ? 1 : result.status);
