import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packagesDir = resolve(import.meta.dirname, '../../packages');
const markdownLinkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*)?\)/g;

describe('published package READMEs', () => {
  it('only use relative links that resolve inside the installed package', () => {
    const brokenLinks: string[] = [];

    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packageDir = resolve(packagesDir, entry.name);
      const manifestPath = resolve(packageDir, 'package.json');
      const readmePath = resolve(packageDir, 'README.md');
      if (!existsSync(manifestPath) || !existsSync(readmePath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { private?: boolean };
      if (manifest.private) continue;

      const markdown = readFileSync(readmePath, 'utf8');
      for (const match of markdown.matchAll(markdownLinkPattern)) {
        const href = match[1].replace(/^<|>$/g, '');
        if (/^(?:[a-z]+:|#)/i.test(href)) continue;
        const target = resolve(dirname(readmePath), decodeURIComponent(href.split('#')[0]));
        const targetFromPackage = relative(packageDir, target);
        if (targetFromPackage.startsWith('..') || !existsSync(target)) {
          brokenLinks.push(`${entry.name}: ${href}`);
        }
      }
    }

    expect(brokenLinks).toEqual([]);
  });
});
