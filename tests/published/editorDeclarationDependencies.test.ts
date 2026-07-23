import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

describe('@bendyline/squisq-editor-react declaration dependencies', () => {
  const packageDir = resolve('packages/editor-react');
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
});
