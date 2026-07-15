import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packagesDir = resolve(import.meta.dirname, '../../packages');

function listJavaScriptFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? listJavaScriptFiles(path)
      : entry.name.endsWith('.js')
        ? [path]
        : [];
  });
}

describe('published JavaScript output', () => {
  it('does not contain empty chunks', () => {
    const emptyFiles = readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => listJavaScriptFiles(join(packagesDir, entry.name, 'dist')))
      .filter((file) => readFileSync(file, 'utf8').trim() === '');

    expect(emptyFiles).toEqual([]);
  });
});
