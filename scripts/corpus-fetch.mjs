/**
 * Corpus fetcher for the extended data-corpus test tier (`npm run test:corpus`).
 *
 * The corpus is real-world office files used to stress the importers and to
 * drive the cached-value oracle. Policy (see the analytics program plan):
 *
 *  - Tier-0 sources are GOVERNMENT OPEN-DATA PORTALS ONLY (agency-published
 *    files, Open Government Licence v3.0). Corpora that ship files of
 *    unidentifiable provenance or known-unsanitized content are excluded.
 *  - Bytes live ONLY in the gitignored `.corpus/` directory; the committed
 *    artifact is `tests/corpus/manifest.json` (URLs + SHA-256 + metadata).
 *  - Fetched files are only ever parsed by squisq's importers (which never
 *    execute content, and whose zip limits bound decompression) — never
 *    opened with other applications.
 *
 * Modes:
 *   node scripts/corpus-fetch.mjs               # fetch + verify per manifest
 *   node scripts/corpus-fetch.mjs --seed        # query data.gov.uk, download,
 *                                               # hash, REWRITE the manifest
 *   Flags: --max-files-xlsx <n> (default 120), --max-files-csv <n> (default 40),
 *          --max-bytes <n per file> (default 10 MiB)
 *
 * URL rot is expected: a missing/changed file is REPORTED (and on fetch,
 * skipped) rather than failing the batch; the corpus tests tolerate absent
 * files and assert floors, not exact counts.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = resolve(repoRoot, 'tests/corpus/manifest.json');
const CORPUS_DIR = resolve(repoRoot, '.corpus/files');

const args = process.argv.slice(2);
const SEED = args.includes('--seed');
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const MAX_XLSX = flag('--max-files-xlsx', 120);
const MAX_CSV = flag('--max-files-csv', 40);
const MAX_BYTES = flag('--max-bytes', 10 * 1024 * 1024);

const CKAN = 'https://ckan.publishing.service.gov.uk/api/action/package_search';
const USER_AGENT = 'squisq-corpus-fetch (github.com/bendyline; test-content research)';
const PER_DATASET_CAP = 2; // diversity: never N near-identical monthly files

function sha256(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function fetchBytes(url, maxBytes) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > maxBytes) return { error: `too large (${declared} B declared)` };
    const chunks = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.byteLength;
      if (total > maxBytes) {
        controller.abort();
        return { error: `too large (>${maxBytes} B streamed)` };
      }
      chunks.push(chunk);
    }
    return { bytes: Buffer.concat(chunks) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Query CKAN for OGL datasets carrying resources of `format`. */
async function ckanResources(format, wanted) {
  const picked = [];
  const seenUrls = new Set();
  for (let start = 0; picked.length < wanted && start < 1000; start += 100) {
    const url = `${CKAN}?q=res_format:${format}+license_id:uk-ogl&rows=100&start=${start}`;
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
    if (!res.ok) break;
    const data = await res.json();
    const results = data?.result?.results ?? [];
    if (results.length === 0) break;
    for (const dataset of results) {
      if (dataset.license_id !== 'uk-ogl') continue;
      let fromDataset = 0;
      for (const resource of dataset.resources ?? []) {
        if ((resource.format ?? '').toUpperCase() !== format) continue;
        const resourceUrl = resource.url ?? '';
        if (!/^https:\/\//.test(resourceUrl) || seenUrls.has(resourceUrl)) continue;
        if (fromDataset >= PER_DATASET_CAP || picked.length >= wanted) break;
        seenUrls.add(resourceUrl);
        fromDataset++;
        picked.push({
          url: resourceUrl,
          dataset: dataset.name,
          org: dataset.organization?.name ?? 'unknown',
        });
      }
      if (picked.length >= wanted) break;
    }
  }
  return picked;
}

function looksLikeFormat(bytes, format) {
  if (format === 'xlsx') return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b; // PK
  return bytes.length > 0;
}

async function seed() {
  console.log(`Seeding manifest from data.gov.uk (OGL only)…`);
  // Over-request: many URLs will 404, redirect to HTML, or exceed the cap.
  const candidates = [
    ...(await ckanResources('XLSX', MAX_XLSX * 2)).map((c) => ({ ...c, format: 'xlsx' })),
    ...(await ckanResources('CSV', MAX_CSV * 2)).map((c) => ({ ...c, format: 'csv' })),
  ];
  console.log(`Candidates: ${candidates.length}. Downloading (cap ${MAX_BYTES} B/file)…`);

  mkdirSync(CORPUS_DIR, { recursive: true });
  const entries = [];
  const counts = { xlsx: 0, csv: 0 };
  const limits = { xlsx: MAX_XLSX, csv: MAX_CSV };
  let skipped = 0;

  for (const candidate of candidates) {
    if (counts[candidate.format] >= limits[candidate.format]) continue;
    const { bytes, error } = await fetchBytes(candidate.url, MAX_BYTES);
    if (!bytes || !looksLikeFormat(bytes, candidate.format)) {
      skipped++;
      continue;
    }
    const digest = sha256(bytes);
    if (entries.some((e) => e.sha256 === digest)) {
      skipped++;
      continue;
    }
    const base = candidate.url.split('/').pop()?.split('?')[0] ?? 'file';
    const id = `${slug(`${candidate.dataset}-${base}`)}-${digest.slice(0, 8)}.${candidate.format}`;
    writeFileSync(resolve(CORPUS_DIR, id), bytes);
    entries.push({
      id,
      url: candidate.url,
      sha256: digest,
      bytes: bytes.byteLength,
      format: candidate.format,
      source: 'data.gov.uk',
      dataset: candidate.dataset,
      org: candidate.org,
      license: 'OGL-UK-3.0',
      provenance: 'agency-published',
      // Candidate flag only — the oracle re-filters per workbook
      // (fullCalcOnLoad, absent caches, volatile functions).
      oracleEligible: candidate.format === 'xlsx',
      expected: 'ok',
    });
    counts[candidate.format]++;
    if ((entries.length & 15) === 0) {
      console.log(`  ${entries.length} stored (${skipped} skipped)…`);
    }
  }

  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(MANIFEST_PATH, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`);
  const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  console.log(
    `Manifest written: ${entries.length} entries (${counts.xlsx} xlsx, ${counts.csv} csv), ` +
      `${(totalBytes / 1024 / 1024).toFixed(1)} MiB, ${skipped} candidates skipped.`,
  );
}

async function fetchFromManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`No manifest at ${MANIFEST_PATH}. Run with --seed first.`);
    process.exitCode = 2;
    return;
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  mkdirSync(CORPUS_DIR, { recursive: true });
  let ok = 0;
  let present = 0;
  const problems = [];
  for (const entry of manifest.entries) {
    const target = resolve(CORPUS_DIR, entry.id);
    if (existsSync(target)) {
      const digest = sha256(readFileSync(target));
      if (digest === entry.sha256) {
        present++;
        continue;
      }
      problems.push(`${entry.id}: local file hash mismatch (refetching)`);
    }
    const { bytes, error } = await fetchBytes(entry.url, MAX_BYTES);
    if (!bytes) {
      problems.push(`${entry.id}: ${error}`);
      continue;
    }
    const digest = sha256(bytes);
    if (digest !== entry.sha256) {
      problems.push(`${entry.id}: remote content drifted (hash mismatch) — not stored`);
      continue;
    }
    writeFileSync(target, bytes);
    ok++;
  }
  console.log(`Corpus: ${present} already present, ${ok} fetched, ${problems.length} problem(s).`);
  for (const problem of problems) console.log(`  ⚠ ${problem}`);
}

if (SEED) await seed();
else await fetchFromManifest();
