/**
 * Shared registry of public Squisq packages for the
 * `tests/published/` suite. Drives the loops in each test file so
 * adding a new published package only requires touching this file.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Repo root (parent of `tests/published/`). */
export const REPO_ROOT = resolve(__dirname, '..', '..');

export interface PublicPackage {
  /** npm name (e.g. `@bendyline/squisq-editor-react`). */
  name: string;
  /** Absolute path to the package directory. */
  dir: string;
  /** Convenience — absolute path to the package's `dist/` directory. */
  dist: string;
  /** Parsed `package.json` contents. */
  pkg: PackageJson;
}

export interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  exports?: Record<string, ExportValue>;
  main?: string;
  module?: string;
  types?: string;
}

/** Shape of a single entry in the `exports` map. */
export type ExportValue = string | { types?: string; import?: string; default?: string };

/** Every public package the monorepo publishes. `site` is private and excluded. */
const PACKAGE_DIRS = [
  'core',
  'formats',
  'react',
  'video',
  'video-react',
  'editor-react',
  'cli',
] as const;

/**
 * Resolved list of public packages, read fresh from disk. Each entry
 * carries a parsed `package.json` so callers don't re-read the file.
 */
export function loadPublicPackages(): PublicPackage[] {
  return PACKAGE_DIRS.map((subdir) => {
    const dir = resolve(REPO_ROOT, 'packages', subdir);
    const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as PackageJson;
    return {
      name: pkg.name,
      dir,
      dist: resolve(dir, 'dist'),
      pkg,
    };
  });
}

/**
 * Flatten an `exports` map into one entry per concrete file the
 * resolver could land on. Handles both shorthand (`"./styles":
 * "./src/styles/index.css"`) and conditional-export object forms
 * (`{ types, import, default }`).
 */
export interface ExportLeaf {
  subpath: string;
  condition: string;
  /** Relative file path as written in package.json. */
  relativeFile: string;
}

export function flattenExports(pkg: PackageJson): ExportLeaf[] {
  const leaves: ExportLeaf[] = [];
  if (!pkg.exports) return leaves;
  for (const [subpath, value] of Object.entries(pkg.exports)) {
    if (typeof value === 'string') {
      leaves.push({ subpath, condition: 'default', relativeFile: value });
    } else {
      for (const [condition, target] of Object.entries(value)) {
        if (typeof target === 'string') {
          leaves.push({ subpath, condition, relativeFile: target });
        }
      }
    }
  }
  return leaves;
}

/**
 * Build the `package.json#name`-prefixed module specifier the way an
 * external consumer would write it — e.g. `@bendyline/squisq/storage`
 * for the `./storage` subpath. The root `.` subpath gets the bare
 * package name.
 */
export function specifierFor(pkg: PublicPackage, subpath: string): string {
  if (subpath === '.') return pkg.name;
  // `./storage` → `storage`
  const tail = subpath.replace(/^\.\//, '');
  return `${pkg.name}/${tail}`;
}
