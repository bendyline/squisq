import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPublicPackages } from './_packages';

/**
 * The media-edit client spawns `new Worker(new URL('./workers/mediaEdit.worker.js',
 * import.meta.url))`. That relative URL only resolves when the module holding
 * it sits at the dist ROOT — a copy inlined into `dist/media-edit/index.js`
 * would look for `dist/media-edit/workers/…` and silently fall back to the
 * main thread.
 */
describe('@bendyline/squisq-video-react media-edit worker asset', () => {
  const pkg = loadPublicPackages().find((candidate) => candidate.name.endsWith('video-react'))!;

  it('publishes the worker', () => {
    expect(existsSync(resolve(pkg.dist, 'workers', 'mediaEdit.worker.js'))).toBe(true);
  });

  it('resolves the worker URL from a module at the dist root only', () => {
    const holders: string[] = [];
    const walk = (dir: string, rel: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        const relative = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(path, relative);
        else if (
          entry.name.endsWith('.js') &&
          readFileSync(path, 'utf8').includes('workers/mediaEdit.worker.js')
        ) {
          holders.push(relative);
        }
      }
    };
    walk(pkg.dist, '');
    expect(holders.length).toBeGreaterThan(0);
    expect(holders.every((file) => !file.includes('/'))).toBe(true);
  });
});
