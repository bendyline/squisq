/**
 * Render a broad sweep of Squisq content in Chromium and WebKit and compare
 * the two engines, so rendering that only breaks in Safari (or only in
 * Chrome) is found by a script instead of on someone's phone.
 *
 *   npm run screenshots:cross-browser
 *   npm run screenshots:cross-browser -- --only "templates|corpus"
 *   npm run screenshots:cross-browser -- --out reports/cross-browser/after-fix
 *
 * Sources: every built-in template fixture (three contrasting themes), every
 * inline site sample, the deck-review corpus, and any local Markdown dropped
 * in reports/cross-browser/docs (gitignored). Each is drawn as slides in
 * landscape and portrait, and the documents also as the linear page view, the
 * plain HTML document preview, and the editor's Write view.
 *
 * For every cell the engines are compared three ways:
 *   - issues     `measureFrame` findings (clipped / out-of-frame / overlapping
 *                text …) that one engine reports and the other does not;
 *   - geometry   text and block boxes that move or resize between engines;
 *   - pixels     the share of a downsampled frame that differs.
 *
 * Output (gitignored): reports/cross-browser/latest/
 *   <engine>/<case>/<cell>.png   each engine's capture
 *   diff/<case>__<cell>.png      Chromium | WebKit | difference, for flagged cells
 *   results.json                 every comparison
 *   summary.md                   flagged cells, worst first
 *   index.html                   the flagged composites, worst first
 *
 * Pages render workspace source through the harness server's Vite aliases,
 * so a fix shows on the next run without rebuilding a package.
 */
import { chromium, webkit, type Browser, type BrowserType, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHarnessServer, REPO_ROOT } from './harness-server.js';

const HARNESS_PATH = '/scripts/cross-browser/index.html';
const DEFAULT_OUT_DIR = 'reports/cross-browser/latest';
const LOCAL_DOCS_DIR = path.join(REPO_ROOT, 'reports', 'cross-browser', 'docs');
const CORPUS_DIR = path.join(REPO_ROOT, 'scripts', 'deck-review', 'corpus');
const TEMPLATE_THEMES = ['standard', 'warm-earth', 'tech-dark'];
const SLIDE_VIEWPORTS = ['landscape', 'portrait'];
const ENGINES: Record<string, BrowserType> = { chromium, webkit };
/** Pages per engine working through the case list at once. */
const PAGES_PER_ENGINE = 3;

interface Options {
  outDir: string;
  only?: RegExp;
  help: boolean;
}

interface Case {
  id: string;
  query: string;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Issue {
  kind: string;
  severity: string;
  layerId?: string;
  detail?: string;
}

interface CellCapture {
  id: string;
  label: string;
  template?: string;
  frame: { w: number; h: number };
  boxes: Record<string, Rect>;
  issues: Issue[];
}

interface CaseCapture {
  error?: string;
  cells: CellCapture[];
}

interface Comparison {
  caseId: string;
  cellId: string;
  label: string;
  pixelScore: number;
  sizeMismatch: boolean;
  /** Issues only one engine reports, as `engine: kind layer`. */
  issueDiffs: string[];
  /** Boxes that move or resize between engines. */
  geometry: string[];
  composite?: string;
  severity: number;
}

function usage(): string {
  return `Render Squisq content in Chromium and WebKit and compare the engines.

Usage:
  npm run screenshots:cross-browser
  npm run screenshots:cross-browser -- --only "<case id regex>"
  npm run screenshots:cross-browser -- --out reports/cross-browser/experiment

Case ids look like templates--warm-earth--portrait, sample--chart-gallery--slides--landscape,
corpus--our-sun--linear, doc--welcome--html, sample--chart-gallery--editor.
`;
}

function parseArgs(args: string[]): Options {
  const options: Options = { outDir: DEFAULT_OUT_DIR, help: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--out') options.outDir = args[++i] ?? DEFAULT_OUT_DIR;
    else if (arg === '--only') options.only = new RegExp(args[++i] ?? '.');
    else throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
  }
  return options;
}

function caseQuery(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

async function markdownNames(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  return (await fs.readdir(dir))
    .filter((file) => file.endsWith('.md'))
    .map((file) => file.slice(0, -3))
    .sort();
}

async function listCases(page: Page, baseUrl: string): Promise<Case[]> {
  await page.goto(`${baseUrl}${HARNESS_PATH}?source=list`);
  const samples = await page.waitForFunction(() => {
    const state = (window as { __SQUISQ_CROSS_BROWSER__?: { ready: boolean; samples?: string[] } })
      .__SQUISQ_CROSS_BROWSER__;
    return state?.ready ? (state.samples ?? []) : null;
  });
  const sampleKeys = (await samples.jsonValue()) as string[];

  const cases: Case[] = [];
  for (const theme of TEMPLATE_THEMES) {
    for (const vp of SLIDE_VIEWPORTS) {
      cases.push({
        id: `templates--${theme}--${vp}`,
        query: caseQuery({ source: 'templates', mode: 'slides', vp, theme }),
      });
    }
  }
  const documents = [
    ...sampleKeys.map((key) => ({ kind: 'sample', name: key })),
    ...(await markdownNames(CORPUS_DIR)).map((name) => ({ kind: 'corpus', name })),
    ...(await markdownNames(LOCAL_DOCS_DIR)).map((name) => ({ kind: 'doc', name })),
  ];
  for (const { kind, name } of documents) {
    const source = `${kind}:${name}`;
    for (const vp of SLIDE_VIEWPORTS) {
      cases.push({
        id: `${kind}--${name}--slides--${vp}`,
        query: caseQuery({ source, mode: 'slides', vp }),
      });
    }
    for (const mode of ['linear', 'html', 'editor']) {
      cases.push({ id: `${kind}--${name}--${mode}`, query: caseQuery({ source, mode }) });
    }
  }
  return cases;
}

/**
 * Text and block boxes inside one frame, in frame CSS px, keyed stably across
 * engines. Plain JavaScript source: the runner's transpiler would otherwise
 * inject helpers the page does not have.
 */
const EXTRACT_BOXES_JS = `(frame) => {
  const origin = frame.getBoundingClientRect();
  const boxes = {};
  const round = (v) => Math.round(v * 10) / 10;
  const add = (key, element) => {
    const r = element.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    boxes[key] = { x: round(r.left - origin.left), y: round(r.top - origin.top), w: round(r.width), h: round(r.height) };
  };
  frame.querySelectorAll('[data-layer-id]').forEach((group) => {
    const content = group.querySelector('[data-squisq-text-content]') || group;
    add('layer:' + group.getAttribute('data-layer-id'), content);
  });
  const blocks = Array.from(frame.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,pre,table,img,figure,blockquote,svg'))
    .filter((element) => !element.closest('[data-layer-id]'));
  blocks.forEach((element, index) => add(element.tagName.toLowerCase() + ':' + index, element));
  const r = frame.getBoundingClientRect();
  return { boxes, frame: { w: r.width, h: r.height } };
}`;

async function captureCase(
  page: Page,
  baseUrl: string,
  testCase: Case,
  dir: string,
): Promise<CaseCapture> {
  await page.goto(`${baseUrl}${HARNESS_PATH}?${testCase.query}`);
  const handle = await page.waitForFunction(
    () => {
      const state = (window as { __SQUISQ_CROSS_BROWSER__?: { ready: boolean } })
        .__SQUISQ_CROSS_BROWSER__;
      return state?.ready ? state : null;
    },
    undefined,
    { timeout: 90_000 },
  );
  const state = (await handle.jsonValue()) as {
    error?: string;
    cells?: Array<{ id: string; label: string; template?: string; metrics?: { issues: Issue[] } }>;
  };
  if (state.error) return { error: state.error, cells: [] };

  await fs.mkdir(dir, { recursive: true });
  const cells: CellCapture[] = [];
  for (const cell of state.cells ?? []) {
    const frame = page.locator(`[data-xb-cell="${cell.id}"] [data-xb-frame]`);
    await frame.screenshot({ path: path.join(dir, `${cell.id}.png`), animations: 'disabled' });
    // An anonymous wrapper gets no injected name helper; the extractor runs as plain source.
    const measured = (await frame.evaluate(
      (element, source) => (0, eval)(`(${source})`)(element),
      EXTRACT_BOXES_JS,
    )) as {
      boxes: Record<string, Rect>;
      frame: { w: number; h: number };
    };
    cells.push({
      id: cell.id,
      label: cell.label,
      template: cell.template,
      frame: measured.frame,
      boxes: measured.boxes,
      issues: (cell.metrics?.issues ?? []).filter((issue) => issue.severity !== 'info'),
    });
  }
  return { cells };
}

async function captureEngine(
  engine: string,
  baseUrl: string,
  cases: Case[],
  outDir: string,
): Promise<Record<string, CaseCapture>> {
  const browser: Browser = await ENGINES[engine]!.launch();
  const results: Record<string, CaseCapture> = {};
  try {
    // A fresh context per case: the editor persists view settings in
    // localStorage, and one case's state must not leak into the next.
    const contextOptions = {
      viewport: { width: 1400, height: 1000 },
      deviceScaleFactor: 2,
      reducedMotion: 'reduce' as const,
    };
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < cases.length) {
        const testCase = cases[next++]!;
        const context = await browser.newContext(contextOptions);
        const page = await context.newPage();
        try {
          results[testCase.id] = await captureCase(
            page,
            baseUrl,
            testCase,
            path.join(outDir, engine, testCase.id),
          );
        } catch (error) {
          results[testCase.id] = {
            error: error instanceof Error ? error.message.split('\n')[0] : String(error),
            cells: [],
          };
        } finally {
          await context.close();
        }
        process.stdout.write(
          `${engine} ${testCase.id}: ${results[testCase.id]!.error ?? `${results[testCase.id]!.cells.length} cells`}\n`,
        );
      }
    };
    await Promise.all(Array.from({ length: PAGES_PER_ENGINE }, worker));
  } finally {
    await browser.close();
  }
  return results;
}

function compareGeometry(a: CellCapture, b: CellCapture, slide: boolean): string[] {
  const findings: string[] = [];
  const size = Math.max(a.frame.h, 1);
  // Slides are absolutely positioned: any move is a defect. A page flows, so
  // a box that grows pushes everything below it — report sizes there, and
  // only the first place the flow diverges.
  const moveTolerance = Math.max(2, size * 0.012);
  let flowDiverged = false;
  for (const [key, ra] of Object.entries(a.boxes)) {
    const rb = b.boxes[key];
    if (!rb) {
      findings.push(`${key} missing in webkit`);
      continue;
    }
    const dw = Math.abs(ra.w - rb.w);
    const dh = Math.abs(ra.h - rb.h);
    const resized = dw > Math.max(4, ra.w * 0.08) || dh > Math.max(4, ra.h * 0.12);
    const moved = Math.abs(ra.x - rb.x) > moveTolerance || Math.abs(ra.y - rb.y) > moveTolerance;
    if (resized)
      findings.push(
        `${key} ${Math.round(ra.w)}×${Math.round(ra.h)} → ${Math.round(rb.w)}×${Math.round(rb.h)}`,
      );
    else if (moved && (slide || !flowDiverged))
      findings.push(
        `${key} moved (${Math.round(rb.x - ra.x)}, ${Math.round(rb.y - ra.y)})${slide ? '' : ' — flow diverges here'}`,
      );
    if (moved && !slide) flowDiverged = true;
  }
  for (const key of Object.keys(b.boxes)) if (!a.boxes[key]) findings.push(`${key} only in webkit`);
  return findings;
}

function compareIssues(a: CellCapture, b: CellCapture): string[] {
  const key = (issue: Issue) => `${issue.kind} ${issue.layerId ?? ''}`.trim();
  const inA = new Set(a.issues.map(key));
  const inB = new Set(b.issues.map(key));
  return [
    ...[...inA].filter((k) => !inB.has(k)).map((k) => `chromium only: ${k}`),
    ...[...inB].filter((k) => !inA.has(k)).map((k) => `webkit only: ${k}`),
  ];
}

/**
 * Pixel score of two captures and a Chromium | WebKit | difference composite,
 * as plain JavaScript source for the page (see EXTRACT_BOXES_JS).
 */
const DIFF_IMAGES_JS = `async ({ aUrl, bUrl }) => {
  const load = (url) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
  const [ia, ib] = await Promise.all([load(aUrl), load(bUrl)]);
  const W = Math.max(ia.width, ib.width);
  const H = Math.max(ia.height, ib.height);
  // Compare at quarter scale: antialiasing and hinting differences between
  // the engines average out; moved or missing content does not.
  const q = 0.25;
  const w = Math.max(1, Math.round(W * q));
  const h = Math.max(1, Math.round(H * q));
  const small = (img) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, img.width * q, img.height * q);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const da = small(ia);
  const db = small(ib);
  const luma = (d, i) => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  // A pixel differs only if nothing within one sample (two CSS px) of it in
  // the other capture matches it, both ways round: the engines place text a
  // pixel apart and round line heights differently, which is not a defect.
  const near = (from, to, x, y) => {
    const v = luma(from, y * w + x);
    let best = 255;
    for (let dy = -1; dy <= 1; dy += 1)
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        best = Math.min(best, Math.abs(v - luma(to, ny * w + nx)));
      }
    return best;
  };
  const mask = new Uint8Array(w * h);
  let differing = 0;
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1)
      if (near(da, db, x, y) > 40 || near(db, da, x, y) > 40) { mask[y * w + x] = 1; differing += 1; }
  // Composite at half scale: Chromium | WebKit | WebKit dimmed, differences in red.
  const half = 0.5;
  const cw = Math.round(W * half);
  const ch = Math.round(H * half);
  const gap = 8;
  const out = document.createElement('canvas');
  out.width = cw * 3 + gap * 2;
  out.height = ch;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#7a7a7a';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(ia, 0, 0, ia.width * half, ia.height * half);
  ctx.drawImage(ib, cw + gap, 0, ib.width * half, ib.height * half);
  ctx.globalAlpha = 0.35;
  ctx.drawImage(ib, (cw + gap) * 2, 0, ib.width * half, ib.height * half);
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = '#ff2d2d';
  const cell = half / q;
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1)
      if (mask[y * w + x]) ctx.fillRect((cw + gap) * 2 + x * cell, y * cell, Math.ceil(cell), Math.ceil(cell));
  return { score: differing / (w * h), sizeMismatch: ia.width !== ib.width || ia.height !== ib.height, composite: out.toDataURL('image/png') };
}`;

/** Pixel score of two captures, and a Chromium | WebKit | difference composite. */
async function diffImages(
  page: Page,
  a: string,
  b: string,
): Promise<{ score: number; sizeMismatch: boolean; composite: string }> {
  const [aData, bData] = await Promise.all([fs.readFile(a), fs.readFile(b)]);
  return page.evaluate(
    `(${DIFF_IMAGES_JS})(${JSON.stringify({
      aUrl: `data:image/png;base64,${aData.toString('base64')}`,
      bUrl: `data:image/png;base64,${bData.toString('base64')}`,
    })})`,
  );
}

function severityOf(c: Omit<Comparison, 'severity'>): number {
  return (
    c.issueDiffs.length * 3 +
    Math.min(c.geometry.length, 5) +
    (c.sizeMismatch ? 2 : 0) +
    c.pixelScore * 20
  );
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const outDir = path.resolve(REPO_ROOT, options.outDir);
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(path.join(outDir, 'diff'), { recursive: true });

  const { server, baseUrl } = await createHarnessServer();
  try {
    const lister = await chromium.launch();
    let cases: Case[];
    try {
      cases = await listCases(await lister.newPage(), baseUrl);
    } finally {
      await lister.close();
    }
    if (options.only) cases = cases.filter((c) => options.only!.test(c.id));
    process.stdout.write(`${cases.length} cases\n`);

    const [chromiumResults, webkitResults] = await Promise.all(
      Object.keys(ENGINES).map((engine) => captureEngine(engine, baseUrl, cases, outDir)),
    );

    const differ = await chromium.launch();
    const comparisons: Comparison[] = [];
    const errors: string[] = [];
    try {
      const page = await differ.newPage();
      for (const testCase of cases) {
        const a = chromiumResults![testCase.id];
        const b = webkitResults![testCase.id];
        if (!a || !b || a.error || b.error) {
          errors.push(`${testCase.id}: chromium ${a?.error ?? 'ok'}; webkit ${b?.error ?? 'ok'}`);
          continue;
        }
        const slide = testCase.id.includes('--slides--') || testCase.id.startsWith('templates');
        for (const cellA of a.cells) {
          const cellB = b.cells.find((c) => c.id === cellA.id);
          if (!cellB) {
            errors.push(`${testCase.id}/${cellA.id}: missing in webkit`);
            continue;
          }
          const images = await diffImages(
            page,
            path.join(outDir, 'chromium', testCase.id, `${cellA.id}.png`),
            path.join(outDir, 'webkit', testCase.id, `${cellA.id}.png`),
          );
          const partial = {
            caseId: testCase.id,
            cellId: cellA.id,
            label: cellA.label,
            pixelScore: Math.round(images.score * 1000) / 1000,
            sizeMismatch: images.sizeMismatch,
            issueDiffs: compareIssues(cellA, cellB),
            geometry: compareGeometry(cellA, cellB, slide),
          };
          const comparison: Comparison = { ...partial, severity: severityOf(partial) };
          if (comparison.severity >= 1) {
            const file = `${testCase.id}__${cellA.id}.png`;
            await fs.writeFile(
              path.join(outDir, 'diff', file),
              Buffer.from(images.composite.split(',')[1]!, 'base64'),
            );
            comparison.composite = `diff/${file}`;
          }
          comparisons.push(comparison);
        }
      }
    } finally {
      await differ.close();
    }

    comparisons.sort((x, y) => y.severity - x.severity);
    await fs.writeFile(
      path.join(outDir, 'results.json'),
      `${JSON.stringify({ errors, comparisons }, null, 2)}\n`,
    );
    const flagged = comparisons.filter((c) => c.composite);
    const lines = [
      `# Cross-browser review`,
      '',
      `${cases.length} cases, ${comparisons.length} cells compared, ${flagged.length} flagged.`,
      '',
      ...(errors.length ? ['## Errors', '', ...errors.map((e) => `- ${e}`), ''] : []),
      '## Flagged cells (worst first)',
      '',
      ...flagged.map((c) =>
        [
          `### ${c.caseId} / ${c.label} — severity ${c.severity.toFixed(1)}`,
          `pixels ${(c.pixelScore * 100).toFixed(1)}%${c.sizeMismatch ? ', frame size differs' : ''}`,
          ...c.issueDiffs.map((d) => `- issue: ${d}`),
          ...c.geometry.slice(0, 8).map((g) => `- box: ${g}`),
          `![](${c.composite})`,
          '',
        ].join('\n'),
      ),
    ];
    await fs.writeFile(path.join(outDir, 'summary.md'), `${lines.join('\n')}\n`);
    await fs.writeFile(
      path.join(outDir, 'index.html'),
      `<!doctype html><meta charset="utf-8"><title>Cross-browser review</title>
<style>body{font:13px system-ui;margin:16px;background:#f4f4f4}figure{margin:0 0 24px}img{max-width:100%;border:1px solid #ccc}code{font-size:12px}</style>
<h1>Cross-browser review</h1><p>Chromium | WebKit | WebKit with differing regions in red. ${flagged.length} of ${comparisons.length} cells flagged.</p>
${flagged
  .map(
    (c) =>
      `<figure><figcaption><b>${c.caseId} / ${c.label}</b> — severity ${c.severity.toFixed(1)}, pixels ${(c.pixelScore * 100).toFixed(1)}%<br><code>${[...c.issueDiffs, ...c.geometry.slice(0, 6)].join('<br>')}</code></figcaption><img src="${c.composite}" loading="lazy"></figure>`,
  )
  .join('\n')}`,
    );
    process.stdout.write(
      `Wrote ${path.relative(REPO_ROOT, outDir)} — ${flagged.length} flagged of ${comparisons.length} cells, ${errors.length} errors\n`,
    );
  } finally {
    await server.close();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
