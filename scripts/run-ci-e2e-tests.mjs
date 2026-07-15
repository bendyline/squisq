import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script through npm run test:e2e:ci.');

const result = spawnSync(process.execPath, [npmCli, 'run', 'test:e2e:built'], {
  cwd: repoRoot,
  env: { ...process.env, CI: '1' },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
