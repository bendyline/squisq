/**
 * The documentation build's file source on Node: the repository on disk.
 * Used by the Vite plugin and the docs test; never bundled into the app.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { DocsFileSource } from './buildDocsSite.ts';

export function nodeDocsSource(repoDir: string): DocsFileSource {
  const resolve = (repoPath: string) => path.join(repoDir, ...repoPath.split('/'));
  const listFiles = (dir: string): string[] => {
    const absolute = resolve(dir);
    if (!fs.existsSync(absolute)) return [];
    return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
      const child = `${dir}/${entry.name}`;
      return entry.isDirectory() ? listFiles(child) : [child];
    });
  };
  return {
    readText: (repoPath) => {
      try {
        return fs.readFileSync(resolve(repoPath), 'utf8');
      } catch {
        return null;
      }
    },
    readBinary: (repoPath) => {
      try {
        return new Uint8Array(fs.readFileSync(resolve(repoPath)));
      } catch {
        return null;
      }
    },
    exists: (repoPath) => fs.existsSync(resolve(repoPath)),
    isDirectory: (repoPath) => {
      try {
        return fs.statSync(resolve(repoPath)).isDirectory();
      } catch {
        return false;
      }
    },
    listFiles,
  };
}
