import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packagesDir = resolve(import.meta.dirname, '../../packages');

describe('published package engines', () => {
  it('match the repository Node.js baseline', () => {
    const rootManifest = JSON.parse(
      readFileSync(resolve(packagesDir, '../package.json'), 'utf8'),
    ) as { engines: { node: string } };
    const mismatches: string[] = [];

    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = resolve(packagesDir, entry.name, 'package.json');
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
          name?: string;
          private?: boolean;
          engines?: { node?: string };
        };
        if (!manifest.name?.startsWith('@bendyline/') || manifest.private) continue;
        if (manifest.engines?.node !== rootManifest.engines.node) {
          mismatches.push(`${manifest.name}: ${manifest.engines?.node ?? 'missing'}`);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }

    expect(mismatches).toEqual([]);
  });
});
