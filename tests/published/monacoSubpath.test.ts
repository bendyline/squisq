import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './_packages';

interface EditorPackageManifest {
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  devDependencies?: Record<string, string>;
}

describe('@bendyline/squisq-editor-react/monaco published output', () => {
  const dist = resolve(REPO_ROOT, 'packages/editor-react/dist');

  it.each(['monaco.js', 'monaco.d.ts'])("%s uses Monaco's resolvable .js API path", (file) => {
    const source = readFileSync(resolve(dist, file), 'utf8');

    expect(source).toContain('monaco-editor/esm/vs/editor/editor.api.js');
    expect(source).not.toMatch(/monaco-editor\/esm\/vs\/editor\/editor\.api["']/);
  });

  it('publishes Monaco as a required peer when public declarations expose its types', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(REPO_ROOT, 'packages/editor-react/package.json'), 'utf8'),
    ) as EditorPackageManifest;
    const declarations = readFileSync(resolve(dist, 'index.d.ts'), 'utf8');

    expect(declarations).toMatch(/from ['"]monaco-editor['"]/);
    expect(manifest.peerDependencies?.['monaco-editor']).toBe('~0.50.0');
    expect(manifest.peerDependenciesMeta?.['monaco-editor']?.optional).not.toBe(true);
    expect(manifest.devDependencies?.['monaco-editor']).toBe('0.50.0');
  });
});
