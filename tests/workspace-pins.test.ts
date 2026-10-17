import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface LockEntry {
  name?: string;
  version?: string;
  link?: boolean;
}

/**
 * Workspace packages pin each other EXACTLY, and npm only links the local
 * workspace when the pin equals that workspace's version. When the two drift
 * apart (a release run that bumped a package's version without publishing it,
 * then pinned its dependents to the last PUBLISHED version), `npm install`
 * quietly fetches the published package from the registry and nests it under
 * the dependent — so `cli` and `editor-react` build against stale code from
 * npm instead of the source next to them, and the cooldown gate reports our
 * own package as too young.
 */
describe('workspace packages resolve to each other', () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const packagesDir = resolve(repoRoot, 'packages');

  const manifests: { dir: string; manifest: PackageManifest }[] = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const manifestPath = resolve(packagesDir, entry.name, 'package.json');
      manifests.push({
        dir: entry.name,
        manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest,
      });
    } catch {
      continue;
    }
  }
  const workspaceVersions = new Map(
    manifests
      .filter(({ manifest }) => manifest.name && manifest.version)
      .map(({ manifest }) => [manifest.name!, manifest.version!]),
  );

  it('pins every workspace dependency to that workspace’s own version', () => {
    const drifted: string[] = [];
    for (const { dir, manifest } of manifests) {
      for (const dependencies of [
        manifest.dependencies,
        manifest.devDependencies,
        manifest.optionalDependencies,
      ]) {
        for (const [name, spec] of Object.entries(dependencies ?? {})) {
          const version = workspaceVersions.get(name);
          if (version === undefined || spec === '*' || spec === version) continue;
          drifted.push(`packages/${dir} pins ${name}@${spec}, but the workspace is ${version}`);
        }
      }
    }
    expect(
      drifted,
      'Make each pin equal the workspace version (or fix a version a release left unpublished)',
    ).toEqual([]);
  });

  it('keeps no registry copy of a workspace package in package-lock.json', () => {
    const lock = JSON.parse(readFileSync(resolve(repoRoot, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, LockEntry>;
    };
    const marker = 'node_modules/';
    const shadowing = Object.entries(lock.packages)
      .filter(([path, entry]) => {
        const index = path.lastIndexOf(marker);
        if (index < 0 || entry.link) return false;
        return workspaceVersions.has(entry.name ?? path.slice(index + marker.length));
      })
      .map(([path, entry]) => `${path}@${entry.version}`);
    expect(
      shadowing,
      'A workspace pin drifted; fix it, then re-run `npm run install:safe`',
    ).toEqual([]);
  });
});
