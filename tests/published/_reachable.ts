/**
 * Walks a BUILT entry's import graph, for tests that bound what an entry may
 * reach. A host that bundles an entry into one file (a CJS editor-extension
 * host, a file-tree walker) inlines every static and dynamic import the
 * bundler can follow, so the graph here is what such a bundle carries.
 */

import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const SPECIFIER_RE =
  /(?:^|[\s;])(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

function specifiersOf(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(SPECIFIER_RE)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier) found.push(specifier);
  }
  return found;
}

/**
 * Every file reachable from `entry` through relative imports, and each
 * bare-specifier import as `file → specifier` (file relative to `packageDir`).
 */
export function reachableFiles(
  entry: string,
  packageDir: string,
): { files: string[]; bare: string[] } {
  const files: string[] = [];
  const bare: string[] = [];
  const queue = [entry];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(file);
    for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.')) queue.push(resolve(dirname(file), specifier));
      else bare.push(`${relative(packageDir, file)} → ${specifier}`);
    }
  }
  return { files, bare };
}
