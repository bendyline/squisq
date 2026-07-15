import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadPublicPackages } from './_packages';

function readJavaScript(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return readJavaScript(path);
      return entry.name.endsWith('.js') ? [readFileSync(path, 'utf8')] : [];
    })
    .join('\n');
}

describe('@bendyline/squisq-video-react worker assets', () => {
  const pkg = loadPublicPackages().find((candidate) => candidate.name.endsWith('video-react'))!;
  const encoderWorker = resolve(pkg.dist, 'workers', 'encode.worker.js');
  const classWorker = resolve(pkg.dist, 'workers', 'ffmpeg.class-worker.js');

  it('publishes both layers of the nested ffmpeg worker topology', () => {
    expect(existsSync(encoderWorker)).toBe(true);
    expect(existsSync(classWorker)).toBe(true);
  });

  it('uses the packaged class worker instead of a bundler-dependent relative default', () => {
    expect(readFileSync(encoderWorker, 'utf8')).toContain('ffmpeg.class-worker.js');
    expect(readJavaScript(pkg.dist)).toContain('workers/ffmpeg.class-worker.js');
  });

  it('bundles the ffmpeg class worker implementation into the published asset', () => {
    const source = readFileSync(classWorker, 'utf8');
    expect(source).toContain('FFMessageType');
    expect(source).not.toMatch(/from ["']@ffmpeg\/ffmpeg\/worker["']/);
  });
});
