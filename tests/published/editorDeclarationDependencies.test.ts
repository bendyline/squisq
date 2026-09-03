import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function listDeclarationFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) return listDeclarationFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.d.ts') ? [entryPath] : [];
  });
}

describe('@bendyline/squisq-editor-react declaration dependencies', () => {
  const packageDir = resolve('packages/editor-react');
  const distDir = resolve(packageDir, 'dist');
  const manifest = JSON.parse(
    readFileSync(resolve(packageDir, 'package.json'), 'utf8'),
  ) as PackageManifest;
  const declarations = [
    readFileSync(resolve(packageDir, 'dist/index.d.ts'), 'utf8'),
    readFileSync(resolve(packageDir, 'dist/shell/index.d.ts'), 'utf8'),
  ].join('\n');

  for (const dependency of ['@tiptap/core', '@tiptap/extension-heading']) {
    it(`declares ${dependency} directly when its public types name that module`, () => {
      expect(declarations).toContain(dependency);
      expect({ ...manifest.peerDependencies, ...manifest.dependencies }).toHaveProperty(dependency);
    });
  }

  it('does not rely on the global JSX namespace removed by React 19 types', () => {
    const offenders = listDeclarationFiles(distDir)
      .filter((file) => /(?<![\w.])JSX\.Element/u.test(readFileSync(file, 'utf8')))
      .map((file) => relative(packageDir, file).replaceAll('\\', '/'));

    expect(offenders).toEqual([]);
  });
});
