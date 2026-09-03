/**
 * Sidecar-threshold benchmark: how expensive is an INLINE markdown table at
 * various sizes, across the paths that run on the editor's 450ms parse
 * debounce? The numbers pick (or validate) the spill thresholds in
 * `xlsxToContainer` / `csvToContainer` (`maxInlineRows` 100 /
 * `maxInlineCells` 2000 / CSV 256 KB).
 *
 * Run against BUILT dists (`npm run build` first):
 *
 *   node scripts/bench/tableScale.mjs
 *
 * Measured per size (median of N runs after warmup):
 *   parse      — parseMarkdown (remark)
 *   toDoc      — markdownToDoc (blocks, auto-templates, structured data)
 *   emit       — docToMarkdown + stringifyMarkdown (the save path)
 *   bridge     — markdownToTiptap (the Write-view ingest)
 *   srcBytes   — serialized source size
 *
 * Results are printed, not persisted — they are point-in-time evidence for
 * the program plan, not a regression suite.
 */

import { performance } from 'node:perf_hooks';

const { parseMarkdown, stringifyMarkdown } = await import('@bendyline/squisq/markdown');
const { markdownToDoc, docToMarkdown } = await import('@bendyline/squisq/doc');
const { markdownToTiptap } = await import('@bendyline/squisq-editor-react');

const SIZES = [50, 100, 250, 500, 1000, 5000, 10000];
const COLS = [5, 20];
const RUNS = 7;
const COMFORT_MS = 50; // debounce-comfort line called out in the program plan

function buildTable(rows, cols) {
  const header = `| ${Array.from({ length: cols }, (_, c) => `Col${c}`).join(' | ')} |`;
  const rule = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`;
  const body = [];
  for (let r = 0; r < rows; r++) {
    body.push(`| ${Array.from({ length: cols }, (_, c) => `r${r}c${c}`).join(' | ')} |`);
  }
  return `# Bench\n\n## Data {[dataTable]}\n\n${header}\n${rule}\n${body.join('\n')}\n`;
}

function median(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function bench(fn) {
  const w0 = performance.now();
  fn(); // warmup
  const warmupMs = performance.now() - w0;
  // A case already in the seconds is not worth 7 repetitions — the answer
  // ("way past the line") doesn't change, and 10k rows costs ~30s/run.
  const runs = warmupMs > 1000 ? 1 : RUNS;
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

console.log(
  'rows'.padStart(6),
  'cols'.padStart(5),
  'srcKB'.padStart(8),
  'parse'.padStart(8),
  'toDoc'.padStart(8),
  'emit'.padStart(8),
  'bridge'.padStart(8),
  'total'.padStart(8),
);

const crossings = [];
for (const cols of COLS) {
  for (const rows of SIZES) {
    const source = buildTable(rows, cols);
    let ast;
    try {
      ast = parseMarkdown(source);
    } catch (err) {
      // The parser's own safety cap (MarkdownLimitError, 100k table cells):
      // above this an inline table cannot even parse — spill is mandatory.
      console.log(
        String(rows).padStart(6),
        String(cols).padStart(5),
        (source.length / 1024).toFixed(1).padStart(8),
        `  parser cap: ${err instanceof Error ? err.message : err}`,
      );
      continue;
    }
    const doc = markdownToDoc(ast);

    const parseMs = bench(() => parseMarkdown(source));
    const toDocMs = bench(() => markdownToDoc(parseMarkdown(source)));
    const emitMs = bench(() => stringifyMarkdown(docToMarkdown(doc)));
    const bridgeMs = bench(() => markdownToTiptap(source));
    const total = toDocMs + emitMs + bridgeMs;

    console.log(
      String(rows).padStart(6),
      String(cols).padStart(5),
      (source.length / 1024).toFixed(1).padStart(8),
      parseMs.toFixed(1).padStart(8),
      toDocMs.toFixed(1).padStart(8),
      emitMs.toFixed(1).padStart(8),
      bridgeMs.toFixed(1).padStart(8),
      total.toFixed(1).padStart(8),
    );
    if (total > COMFORT_MS && !crossings.some((c) => c.cols === cols)) {
      crossings.push({ cols, rows, total });
    }
  }
}

console.log('');
for (const c of crossings) {
  console.log(
    `~${c.cols}-col tables cross the ${COMFORT_MS}ms debounce-comfort line at ${c.rows} rows (${c.total.toFixed(0)}ms).`,
  );
}
console.log(
  'Shipped spill defaults: maxInlineRows=100, maxInlineCells=2000, CSV maxInlineBytes=256KB.',
);
