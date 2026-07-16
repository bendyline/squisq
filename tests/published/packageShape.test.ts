import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { loadPublicPackages } from './_packages';

interface PackFile {
  path: string;
  size: number;
}

interface PackResult {
  name: string;
  size: number;
  unpackedSize: number;
  files: PackFile[];
}

const PACKED_SIZE_BUDGETS: Record<string, number> = {
  // These are coarse release guardrails, not byte-level regression targets.
  // Keep enough headroom that normal feature work does not require continually
  // ratcheting the limits while still catching accidental payload additions.
  '@bendyline/squisq': 650_000,
  '@bendyline/squisq-formats': 200_000,
  '@bendyline/squisq-react': 2_750_000,
  '@bendyline/squisq-video': 35_000,
  '@bendyline/squisq-video-react': 75_000,
  '@bendyline/squisq-editor-react': 1_000_000,
  // Includes the compressed light standalone player so CLI-only installs no
  // longer pull the complete React/Mermaid dependency graph.
  '@bendyline/squisq-cli': 550_000,
};

function dryRunPack(directory: string, cache: string): PackResult {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = [...(npmCli ? [npmCli] : []), 'pack', '--dry-run', '--json', '--cache', cache];
  const result = spawnSync(command, args, {
    cwd: directory,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`npm pack failed:\n${result.stderr || result.stdout}`);
  }
  return (JSON.parse(result.stdout) as PackResult[])[0]!;
}

describe('published npm package shape', () => {
  it('ships only runtime artifacts, licenses, and bounded tarballs', () => {
    const cache = mkdtempSync(join(tmpdir(), 'squisq-pack-cache-'));
    try {
      for (const pkg of loadPublicPackages()) {
        const packed = dryRunPack(pkg.dir, cache);
        const paths = packed.files.map((file) => file.path.replaceAll('\\', '/'));
        expect(paths, pkg.name).toContain('LICENSE');
        expect(
          paths.filter(
            (path) =>
              path.endsWith('.map') ||
              path.includes('/__tests__/') ||
              /(?:^|\/)src\//.test(path) ||
              /\.test\.[cm]?[jt]sx?$/.test(path),
          ),
          `${pkg.name} contains development-only files`,
        ).toEqual([]);
        expect(packed.size, `${pkg.name} packed size`).toBeLessThanOrEqual(
          PACKED_SIZE_BUDGETS[pkg.name]!,
        );
      }
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  }, 30_000);
});
