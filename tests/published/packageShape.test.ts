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

function isPackResult(value: unknown): value is PackResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PackResult>;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.size === 'number' &&
    Array.isArray(candidate.files)
  );
}

function parsePackResult(stdout: string, directory: string): PackResult {
  const parsed: unknown = JSON.parse(stdout);
  const candidates = Array.isArray(parsed)
    ? parsed
    : isPackResult(parsed)
      ? [parsed]
      : parsed && typeof parsed === 'object'
        ? Object.values(parsed).flatMap((value) => (Array.isArray(value) ? value : [value]))
        : [];
  const packed = candidates.find(isPackResult);
  if (!packed) {
    throw new Error(`npm pack returned no package for ${directory}:\n${stdout}`);
  }
  return packed;
}

const PACKED_SIZE_BUDGETS: Record<string, number> = {
  // These are coarse release guardrails, not byte-level regression targets.
  // Keep enough headroom that normal feature work does not require continually
  // ratcheting the limits while still catching accidental payload additions.
  '@bendyline/squisq': 650_000,
  // Includes the three Font Awesome OpenType faces embedded for portable
  // DOCX/PDF/PPTX/EPUB inline-icon export.
  '@bendyline/squisq-formats': 700_000,
  '@bendyline/squisq-react': 2_750_000,
  '@bendyline/squisq-video': 35_000,
  '@bendyline/squisq-video-react': 75_000,
  '@bendyline/squisq-editor-react': 1_000_000,
  // Includes compressed light and full standalone players plus one shared
  // Font Awesome webfont payload so CLI video export remains self-contained
  // without duplicating the fonts into both player variants.
  '@bendyline/squisq-cli': 2_250_000,
};

function dryRunPack(directory: string, cache: string): PackResult {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = [
    ...(npmCli ? [npmCli] : []),
    'pack',
    '.',
    '--dry-run',
    '--json',
    '--ignore-scripts',
    '--workspaces=false',
    '--cache',
    cache,
  ];
  const result = spawnSync(command, args, {
    cwd: directory,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`npm pack failed:\n${result.stderr || result.stdout}`);
  }
  return parsePackResult(result.stdout, directory);
}

describe('npm pack JSON compatibility', () => {
  const packed: PackResult = {
    name: '@bendyline/example',
    size: 1,
    unpackedSize: 2,
    files: [],
  };

  it.each([
    ['array', [packed]],
    ['direct object', packed],
    ['package-keyed object', { [packed.name]: packed }],
  ])('accepts the %s response shape', (_shape, response) => {
    expect(parsePackResult(JSON.stringify(response), '/example')).toEqual(packed);
  });
});

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
