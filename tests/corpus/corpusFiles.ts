/**
 * Shared access to the fetched corpus for the `tests/corpus/` tier.
 *
 * The committed artifact is `manifest.json` (URLs + SHA-256 + metadata);
 * the bytes live in the gitignored `.corpus/files/` populated by
 * `node scripts/corpus-fetch.mjs`. Absent files are tolerated (URL rot is
 * expected); an entirely absent corpus makes the tier skip with a warning
 * unless SQUISQ_CORPUS=required.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CorpusEntry {
  id: string;
  url: string;
  sha256: string;
  bytes: number;
  format: 'xlsx' | 'csv';
  source: string;
  dataset: string;
  org: string;
  license: string;
  provenance: string;
  oracleEligible: boolean;
  expected: string;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CORPUS_DIR = resolve(repoRoot, '.corpus', 'files');
export const REPORT_DIR = resolve(repoRoot, '.corpus', 'report');
const MANIFEST_PATH = resolve(repoRoot, 'tests', 'corpus', 'manifest.json');

export function loadManifest(): CorpusEntry[] {
  if (!existsSync(MANIFEST_PATH)) return [];
  const parsed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as { entries: CorpusEntry[] };
  return parsed.entries;
}

/** Manifest entries whose bytes are actually present locally. */
export function presentEntries(format?: 'xlsx' | 'csv'): CorpusEntry[] {
  return loadManifest().filter(
    (entry) => (!format || entry.format === format) && existsSync(resolve(CORPUS_DIR, entry.id)),
  );
}

export function entryBytes(entry: CorpusEntry): ArrayBuffer {
  const buf = readFileSync(resolve(CORPUS_DIR, entry.id));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * True when the tier should run. Skips (with a loud warning) when the corpus
 * hasn't been fetched; SQUISQ_CORPUS=required turns absence into a failure.
 */
export function corpusAvailable(): boolean {
  const present = presentEntries();
  if (present.length > 0) return true;
  const message =
    '[corpus] No corpus files present — run `node scripts/corpus-fetch.mjs` first ' +
    '(or `--seed` to build a fresh manifest).';
  if (process.env.SQUISQ_CORPUS === 'required') {
    throw new Error(message);
  }
  console.warn(`${message} Skipping the corpus tier.`);
  return false;
}
