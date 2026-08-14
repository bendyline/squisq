import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  private?: boolean;
  files?: string[];
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

  it('records the ffmpeg core license and upstream dependency neutrally', () => {
    expect(notice).toMatch(/\|\s*@ffmpeg\/core\s*\|\s*0\.12\.9\s*\|\s*GPL-2\.0-or-later\s*\|/);
    expect(notice).toContain('has an upstream dependency on FFmpeg and external libraries');
    expect(notice).not.toContain('does not relicense');
    expect(notice).not.toContain('badge displayed');
    expect(notice).toContain('d3c018aa40a241384965268f0506b73f47dee60c');
  });

  it('records Mermaid and its verified license', () => {
    expect(notice).toMatch(/\|\s*mermaid\s*\|\s*11\.16\.1\s*\|\s*MIT\s*\|/);
    expect(notice).toContain('Copyright (c) 2014-2022 Knut Sveidqvist');
  });

  it('ships a package-scoped notice and MIT license in every published package', () => {
    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packageDir = resolve(packagesDir, entry.name);
      let manifest: PackageManifest;
      try {
        manifest = JSON.parse(
          readFileSync(resolve(packageDir, 'package.json'), 'utf8'),
        ) as PackageManifest;
      } catch {
        continue;
      }
      if (manifest.private) continue;

      const packageNotice = readFileSync(resolve(packageDir, 'NOTICE.md'), 'utf8');
      const dependencies = [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ].filter((name) => !name.startsWith('@bendyline/'));
      const missing = dependencies.filter(
        (name) => !new RegExp(`\\|\\s*${escapeRegExp(name)}(?:\\s|_)`).test(packageNotice),
      );
      expect(missing, `${entry.name}/NOTICE.md must cover its package dependencies`).toEqual([]);
      expect(manifest.files, `${entry.name} must explicitly publish NOTICE.md`).toContain(
        'NOTICE.md',
      );
      expect(manifest.files, `${entry.name} must explicitly publish LICENSE`).toContain('LICENSE');
      expect(
        manifest.files,
        `${entry.name} must explicitly publish bundled third-party licenses`,
      ).toContain('THIRD_PARTY_LICENSES.txt');
      const bundledLicenses = readFileSync(resolve(packageDir, 'THIRD_PARTY_LICENSES.txt'), 'utf8');
      expect(bundledLicenses).toContain(`THIRD-PARTY LICENSES FOR ${manifest.name}`);
    }
  });

  it('does not treat Squisq workspace packages as third-party dependencies', () => {
    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = JSON.parse(
        readFileSync(resolve(packagesDir, entry.name, 'package.json'), 'utf8'),
      ) as PackageManifest;
      if (manifest.private) continue;
      const packageNotice = readFileSync(resolve(packagesDir, entry.name, 'NOTICE.md'), 'utf8');
      expect(packageNotice, `${entry.name}/NOTICE.md`).not.toMatch(/\|\s*@bendyline\//);
    }
  });

  it('omits ffmpeg notices from packages that do not use ffmpeg', () => {
    for (const packageName of ['core', 'react', 'formats', 'editor-react', 'cli']) {
      const packageNotice = readFileSync(resolve(packagesDir, packageName, 'NOTICE.md'), 'utf8');
      expect(packageNotice.toLowerCase(), `${packageName}/NOTICE.md`).not.toContain('ffmpeg');
    }

    const videoNotice = readFileSync(resolve(packagesDir, 'video/NOTICE.md'), 'utf8');
    expect(videoNotice).toContain('@ffmpeg/ffmpeg');
    expect(videoNotice).toContain('@ffmpeg/util');
    expect(videoNotice).not.toContain('GPL-2.0-or-later');
  });

  it('ships an exact GPLv2 copy and component notice with the ffmpeg integration', () => {
    const canonicalGpl = readFileSync(
      resolve(repoRoot, 'third_party/ffmpeg-core/COPYING.GPL-2.0.txt'),
      'utf8',
    );
    const packageGpl = readFileSync(
      resolve(packagesDir, 'video-react/COPYING.GPL-2.0.txt'),
      'utf8',
    );
    const componentNotice = readFileSync(
      resolve(repoRoot, 'third_party/ffmpeg-core/NOTICE.md'),
      'utf8',
    );
    const videoReactManifest = JSON.parse(
      readFileSync(resolve(packagesDir, 'video-react/package.json'), 'utf8'),
    ) as PackageManifest;

    expect(packageGpl).toBe(canonicalGpl);
    expect(canonicalGpl).toContain('GNU GENERAL PUBLIC LICENSE');
    expect(canonicalGpl).toContain('Version 2, June 1991');
    expect(componentNotice).toContain(
      '9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7',
    );
    expect(componentNotice).toContain('releases/tag/v12.14');
    expect(componentNotice).toContain('upstream dependency on the\nFFmpeg project');
    expect(componentNotice).not.toContain('does not relicense');
    const videoReactNotice = readFileSync(resolve(packagesDir, 'video-react/NOTICE.md'), 'utf8');
    expect(videoReactNotice).toContain('@ffmpeg/core');
    expect(videoReactNotice).toContain('GPL-2.0-or-later');
    expect(videoReactManifest.files).toContain('COPYING.GPL-2.0.txt');
  });

  it('publishes local legal materials with the demo-site core files', () => {
    const viteConfig = readFileSync(resolve(packagesDir, 'site/vite.config.ts'), 'utf8');
    for (const publicPath of [
      '/ffmpeg-core/NOTICE.md',
      '/ffmpeg-core/COPYING.GPL-2.0.txt',
      '/legal/LICENSE.txt',
      '/legal/NOTICE.md',
    ]) {
      expect(viteConfig).toContain(publicPath);
    }
  });
});
