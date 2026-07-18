import { readFileSync, readdirSync } from 'node:fs';
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

  it('publishes the curated core and keeps languages behind dynamic imports', () => {
    const source = readFileSync(resolve(dist, 'monaco.js'), 'utf8');
    const runtime = readdirSync(dist)
      .filter((file) => file.endsWith('.js'))
      .map((file) => readFileSync(resolve(dist, file), 'utf8'))
      .join('\n');

    expect(runtime).not.toContain('editor.main.js');
    expect(runtime).not.toContain('editor.all.js');
    expect(runtime).not.toContain('basic-languages/monaco.contribution');
    expect(source).not.toContain('suggest/browser/suggestController.js');
    expect(source).not.toContain('snippet/browser/snippetController2.js');
    expect(runtime).toContain('suggest/browser/suggestController.js');
    expect(runtime).toContain('snippet/browser/snippetController2.js');
    expect(runtime).toContain('loadMonacoLanguages');
    expect(runtime).toMatch(/import\(["']\.\/monacoSuggestions/);
    expect(runtime).toMatch(/import\(["']monaco-editor\/esm\/vs\/basic-languages\//);
    expect(runtime).toMatch(/import\(["']monaco-editor\/esm\/vs\/language\/typescript/);
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

describe('@bendyline/squisq-editor-react/monaco-workers published output', () => {
  const dist = resolve(REPO_ROOT, 'packages/editor-react/dist');

  it('exposes worker configuration without importing the editor or Monaco runtime', () => {
    const source = readFileSync(resolve(dist, 'monaco-workers/index.js'), 'utf8');

    expect(source).toContain('configureMonacoWorkers');
    expect(source).not.toContain('EditorShell');
    expect(source).not.toContain('monaco-editor');
  });
});
