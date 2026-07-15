import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './_packages';

function packageJson(packageDir: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} {
  return JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'packages', packageDir, 'package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

describe('legacy browser dependencies are isolated from consumers', () => {
  it('bundles mp4-muxer without publishing its conflicting DOM type dependencies', () => {
    const manifest = packageJson('video-react');
    const bundle = readFileSync(resolve(REPO_ROOT, 'packages/video-react/dist/index.js'), 'utf8');

    expect(manifest.dependencies).not.toHaveProperty('mp4-muxer');
    expect(manifest.devDependencies).toHaveProperty('mp4-muxer');
    expect(bundle).not.toMatch(/from\s+["']mp4-muxer["']/);
  });

  it('bundles the Monaco React adapter without publishing its mandatory Monaco peer', () => {
    const manifest = packageJson('editor-react');
    const bundle = readFileSync(resolve(REPO_ROOT, 'packages/editor-react/dist/index.js'), 'utf8');

    expect(manifest.dependencies).not.toHaveProperty('@monaco-editor/react');
    expect(manifest.devDependencies).toHaveProperty('@monaco-editor/react');
    expect(bundle).not.toMatch(/from\s+["']@monaco-editor\/react["']/);
    expect(bundle).not.toMatch(/from\s+["']@monaco-editor\/loader["']/);
  });
});
