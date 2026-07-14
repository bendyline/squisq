import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('third-party notices stay in sync', () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const packagesDir = resolve(repoRoot, 'packages');
  const notice = readFileSync(resolve(repoRoot, 'NOTICE.md'), 'utf8');

  it('mentions every external direct or peer dependency used by a workspace package', () => {
    const externalDependencies = new Set<string>();
    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = resolve(packagesDir, entry.name, 'package.json');
      let manifest: PackageManifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
      } catch {
        continue;
      }
      for (const dependencies of [
        manifest.dependencies,
        manifest.optionalDependencies,
        manifest.peerDependencies,
      ]) {
        for (const name of Object.keys(dependencies ?? {})) {
          if (!name.startsWith('@bendyline/')) externalDependencies.add(name);
        }
      }
    }

    const missing = [...externalDependencies]
      .filter((name) => !new RegExp(`\\|\\s*${escapeRegExp(name)}(?:\\s|_)`).test(notice))
      .sort();
    expect(missing, 'Add every external workspace dependency to NOTICE.md').toEqual([]);
  });

  it('records the non-permissive ffmpeg core separately from the MIT wrappers', () => {
    expect(notice).toMatch(/\|\s*@ffmpeg\/core\s*\|\s*0\.12\.9\s*\|\s*GPL-2\.0-or-later\s*\|/);
    expect(notice).toMatch(/The separately\s+distributed `@ffmpeg\/core` WebAssembly runtime/);
  });

  it('records Mermaid and its verified license', () => {
    expect(notice).toMatch(/\|\s*mermaid\s*\|\s*11\.16\.0\s*\|\s*MIT\s*\|/);
    expect(notice).toContain('Copyright (c) 2014-2022 Knut Sveidqvist');
  });
});
