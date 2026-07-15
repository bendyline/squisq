import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('package notices', () => {
  it('match current manifests and installed dependency metadata', () => {
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), 'scripts/generate-notices.mjs'), '--check'],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });
});
