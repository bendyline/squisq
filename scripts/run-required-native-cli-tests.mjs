import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script through npm run test:cli:native:required.');

const result = spawnSync(process.execPath, [npmCli, 'run', 'test:cli:native'], {
  cwd: repoRoot,
  env: { ...process.env, SQUISQ_REQUIRE_NATIVE_E2E: '1' },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
