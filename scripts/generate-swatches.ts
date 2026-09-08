/**
 * Render "swatch cards" — every built-in block template × every built-in
 * theme × a library of realistic content variants — to PNG, then write a
 * contact sheet and an issues report so a reviewer (human or agent) can scan
 * for content that stops looking right in a given theme.
 *
 *   npm run screenshots:swatches
 *   npm run screenshots:swatches -- --theme bold,cinematic --template list,quote
 *   npm run screenshots:swatches -- --variant long,bullets-many --orientation portrait
 *   npm run screenshots:swatches -- --montage      # also write per-(template,variant) theme grids
 *
 * Output (gitignored): reports/swatches/latest/
 *   <orientation>/<theme>/<template>/<variant>.png   the swatches
 *   montage/<orientation>--<template>--<variant>.png optional theme grids
 *   index.html                                       filterable contact sheet
 *   manifest.json / issues.json                      machine-readable results
 *   summary.md                                       the review worklist
 *
 * The harness (packages/site/src/swatches/) renders workspace *source* through
 * Vite aliases — like scripts/generate-template-screenshots.mjs — so a template
 * or theme edit shows up on the next run without rebuilding any package. It
 * differs from that script in feeding real Markdown through markdownToDoc
 * (the content axis) and measuring the rendered DOM for overflow, overlap,
 * clipping, tiny type, fallbacks and dropped body text.
 */

import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer, type Plugin, type PluginOption, type ViteDevServer } from 'vite';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS_PATH = '/scripts/swatches/index.html';
const ASSETS_DIR = path.join(REPO_ROOT, 'scripts', 'swatches', 'assets');
const SITE_PUBLIC_DIR = path.join(REPO_ROOT, 'packages', 'site', 'public');
const DEFAULT_OUT_DIR = 'reports/swatches/latest';
const CAPTURE_ATTEMPTS = 3;
const VARIANTS_PER_PAGE = 6;

type Orientation = 'landscape' | 'portrait' | 'square';
type Severity = 'high' | 'warn' | 'info';

interface Options {
  outDir: string;
  themes: string[];
  templates: string[];
  variants: string[];
  orientations: Orientation[];
  workers: number;
  montage: boolean;
  googleFonts: boolean;
  allVariants: boolean;
  keep: boolean;
  list: boolean;
  help: boolean;
}

interface Manifest {
  orientations: Record<
    Orientation,
    { viewport: { width: number; height: number }; css: { width: number; height: number } }
  >;
  themes: Array<{ id: string; name: string; description?: string }>;
  templates: Array<{
    id: string;
    label: string;
    description: string;
    bodyExpectation: 'full' | 'partial' | 'none';
    applicableVariants: string[];
  }>;
  variants: Array<{ id: string; label: string; description: string; features: string[] }>;
}

interface Issue {
  kind: string;
  severity: Severity;
  layerId?: string;
  detail: string;
  px?: number;
}

interface HarnessResult {
  variant: string;
  applicable: boolean;
  markdown: string;
  heading: string;
  diagnostics: Array<{ code: string; message: string }>;
  metrics: {
    layerCount: number;
    textLayerCount: number;
    minFontPx: number | null;
    renderedText: string;
    bodyCoverage: number | null;
    issues: Issue[];
  };
}

interface HarnessState {
  ready: boolean;
  manifest: Manifest;
  results: Record<string, HarnessResult>;
  error?: string;
}

interface SwatchRecord {
  theme: string;
  template: string;
  variant: string;
  orientation: Orientation;
  path: string;
  applicable: boolean;
  bodyExpectation: 'full' | 'partial' | 'none';
  heading: string;
  markdown: string;
  diagnostics: Array<{ code: string; message: string }>;
  minFontPx: number | null;
  bodyCoverage: number | null;
  layerCount: number;
  issues: Issue[];
  /** Highest severity after applying expectations (fallback on inapplicable → info). */
  severity: Severity | 'none';
  /** Browser console/page errors seen while this job rendered (deduplicated). */
  consoleErrors?: string[];
}

interface Job {
  theme: Manifest['themes'][number];
  template: Manifest['templates'][number];
  orientation: Orientation;
  variants: string[];
}

function usage(): string {
  return `Render swatch cards for every block template × theme × content variant.

Usage:
  npm run screenshots:swatches
  npm run screenshots:swatches -- --theme bold,cinematic --template list,quote
  npm run screenshots:swatches -- --variant long,bullets-many --orientation portrait
  npm run screenshots:swatches -- --montage

Options:
  --out <dir>            Output directory (default ${DEFAULT_OUT_DIR}; must stay inside the repo)
  --theme <ids>          Comma-separated theme ids (repeatable)
  --template <ids>       Comma-separated template ids (repeatable)
  --variant <ids>        Comma-separated content variant ids (repeatable)
  --orientation <list>   landscape | portrait | square (comma-separated; default landscape)
  --workers <n>          Parallel pages (default: min(6, cpus-1))
  --all-variants         Also capture variants a template cannot use (expected fallback cards)
  --google-fonts         Also load Google Fonts (default: only the site's self-hosted fonts)
  --montage              Write montage/<orientation>--<template>--<variant>.png theme grids
  --keep                 Do not clear the output directory first
  --list                 Print themes, templates and variants, then exit
  --help                 Show this message
`;
}

function splitIds(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    outDir: DEFAULT_OUT_DIR,
    themes: [],
    templates: [],
    variants: [],
    orientations: [],
    workers: Math.max(1, Math.min(6, os.cpus().length - 1)),
    montage: false,
    googleFonts: false,
    allVariants: false,
    keep: false,
    list: false,
    help: false,
  };
  const takeValue = (i: number, flag: string): string => {
    const value = argv[i];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--list':
        options.list = true;
        break;
      case '--out':
        options.outDir = takeValue(++i, arg);
        break;
      case '--theme':
        options.themes.push(...splitIds(takeValue(++i, arg)));
        break;
      case '--template':
        options.templates.push(...splitIds(takeValue(++i, arg)));
        break;
      case '--variant':
        options.variants.push(...splitIds(takeValue(++i, arg)));
        break;
      case '--orientation': {
        for (const o of splitIds(takeValue(++i, arg))) {
          if (o !== 'landscape' && o !== 'portrait' && o !== 'square') {
            throw new Error(`Unknown orientation "${o}" (landscape, portrait, square)`);
          }
          options.orientations.push(o);
        }
        break;
      }
      case '--workers': {
        const n = Number(takeValue(++i, arg));
        if (!Number.isInteger(n) || n < 1) throw new Error('--workers expects a positive integer');
        options.workers = n;
        break;
      }
      case '--all-variants':
        options.allVariants = true;
        break;
      case '--google-fonts':
        options.googleFonts = true;
        break;
      case '--montage':
        options.montage = true;
        break;
      case '--keep':
        options.keep = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
    }
  }
  if (options.orientations.length === 0) options.orientations.push('landscape');
  return options;
}

// ---------------------------------------------------------------------------
// Vite harness server
// ---------------------------------------------------------------------------

/** Point every workspace package specifier at its source entry (no rebuild loop). */
function workspaceSourceAliases(): Array<{ find: RegExp; replacement: string }> {
  const core = (rel: string) => path.join(REPO_ROOT, 'packages', 'core', 'src', rel);
  const reactPkg = (rel: string) => path.join(REPO_ROOT, 'packages', 'react', 'src', rel);
  const coreSubpaths = [
    'schemas',
    'spatial',
    'doc',
    'storage',
    'markdown',
    'timing',
    'random',
    'generate',
    'transform',
    'versions',
    'jsonForm',
    'imageEdit',
    'icons',
    'recommend',
    'narration',
    'fence',
    'proof',
    'table',
  ];
  const reactSubpaths = ['player', 'page', 'layers', 'hooks', 'markdown', 'json-view'];
  return [
    { find: /^@bendyline\/squisq\/icon-marker$/, replacement: core('icons/inlineIconMarker.ts') },
    ...coreSubpaths.map((s) => ({
      find: new RegExp(`^@bendyline/squisq/${s}$`),
      replacement: core(`${s}/index.ts`),
    })),
    { find: /^@bendyline\/squisq$/, replacement: core('index.ts') },
    { find: /^@bendyline\/squisq-react\/styles$/, replacement: reactPkg('styles/index.css') },
    ...reactSubpaths.map((s) => ({
      find: new RegExp(`^@bendyline/squisq-react/${s}$`),
      replacement: reactPkg(`${s}/index.ts`),
    })),
    { find: /^@bendyline\/squisq-react$/, replacement: reactPkg('index.ts') },
  ];
}

const MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/** Serve the placeholder media under /swatch-assets without touching publicDir. */
function swatchAssetsPlugin(): Plugin {
  return {
    name: 'squisq-swatch-assets',
    configureServer(server) {
      server.middlewares.use('/swatch-assets', async (req, res, next) => {
        const name = path.basename(decodeURIComponent((req.url ?? '/').split('?')[0]));
        const file = path.join(ASSETS_DIR, name);
        if (!name || !existsSync(file)) return next();
        const body = await fs.readFile(file);
        res.setHeader('Content-Type', MIME[path.extname(name)] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.end(body);
      });
    },
  };
}

/**
 * `@vitejs/plugin-react` is a devDependency of the site workspace, not the
 * root, so resolve it from there instead of assuming npm hoisted it.
 */
async function loadReactPlugin(): Promise<PluginOption> {
  const siteRequire = createRequire(path.join(REPO_ROOT, 'packages', 'site', 'package.json'));
  const entry = siteRequire.resolve('@vitejs/plugin-react');
  const mod = (await import(pathToFileURL(entry).href)) as {
    default?: () => PluginOption;
  };
  if (typeof mod.default !== 'function') {
    throw new Error('Unable to load @vitejs/plugin-react from packages/site.');
  }
  return mod.default();
}

async function createHarnessServer(): Promise<{ server: ViteDevServer; baseUrl: string }> {
  const server = await createServer({
    root: REPO_ROOT,
    configFile: false,
    appType: 'mpa',
    logLevel: 'warn',
    publicDir: SITE_PUBLIC_DIR,
    plugins: [await loadReactPlugin(), swatchAssetsPlugin()],
    resolve: {
      alias: workspaceSourceAliases(),
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
      exclude: [
        '@bendyline/squisq',
        '@bendyline/squisq-react',
        '@bendyline/squisq-editor-react',
        '@bendyline/squisq-formats',
        '@bendyline/squisq-video',
        '@bendyline/squisq-video-react',
      ],
    },
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      open: false,
      fs: { allow: [REPO_ROOT] },
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    await server.close();
    throw new Error('Unable to resolve the Vite server address.');
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

class HarnessError extends Error {}

type HarnessWindow = Window & { __SQUISQ_SWATCHES__?: HarnessState };

async function loadHarness(page: Page, url: string): Promise<HarnessState> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => (window as HarnessWindow).__SQUISQ_SWATCHES__?.ready === true,
    undefined,
    { timeout: 45_000 },
  );
  const state = await page.evaluate(
    () => (window as HarnessWindow).__SQUISQ_SWATCHES__ as HarnessState,
  );
  if (!state?.manifest) throw new Error('The swatch harness did not expose a manifest.');
  return state;
}

async function readManifest(page: Page, baseUrl: string): Promise<Manifest> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CAPTURE_ATTEMPTS; attempt += 1) {
    try {
      const state = await loadHarness(page, `${baseUrl}${HARNESS_PATH}`);
      if (state.error) throw new HarnessError(state.error);
      return state.manifest;
    } catch (error) {
      if (error instanceof HarnessError) throw error;
      lastError = error;
      // Vite may reload once while it pre-bundles dependencies on first load.
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw lastError;
}

function filterIds<T extends { id: string }>(items: T[], ids: string[], kind: string): T[] {
  if (ids.length === 0) return items;
  const known = new Set(items.map((i) => i.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Error(`Unknown ${kind} id(s): ${unknown.join(', ')}`);
  const wanted = new Set(ids);
  return items.filter((i) => wanted.has(i.id));
}

function safeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-');
}

function resolveOutputDir(outDir: string): string {
  const resolved = path.isAbsolute(outDir) ? outDir : path.resolve(REPO_ROOT, outDir);
  const relative = path.relative(REPO_ROOT, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Refusing to write outside the repository; pick an --out inside it.');
  }
  return resolved;
}

const SEVERITY_RANK: Record<Severity | 'none', number> = { none: 0, info: 1, warn: 2, high: 3 };

/** Downgrade issues that are expected for the combination, then rank. */
function applyExpectations(
  result: HarnessResult,
  bodyExpectation: SwatchRecord['bodyExpectation'],
): { issues: Issue[]; severity: SwatchRecord['severity'] } {
  const issues = result.metrics.issues.map((issue) => {
    if (issue.kind === 'fallback' && !result.applicable) {
      return {
        ...issue,
        severity: 'info' as const,
        detail: `${issue.detail} (expected: variant does not fit this template)`,
      };
    }
    return issue;
  });
  const coverage = result.metrics.bodyCoverage;
  if (
    result.applicable &&
    coverage !== null &&
    bodyExpectation === 'full' &&
    coverage < 0.6 &&
    !issues.some((i) => i.kind === 'fallback')
  ) {
    issues.push({
      kind: 'body-dropped',
      severity: coverage < 0.3 ? 'high' : 'warn',
      detail: `only ${Math.round(coverage * 100)}% of the body's distinctive words are visible, but this template is expected to show the whole body`,
    });
  }
  let severity: SwatchRecord['severity'] = 'none';
  for (const issue of issues) {
    if (SEVERITY_RANK[issue.severity] > SEVERITY_RANK[severity]) severity = issue.severity;
  }
  return { issues, severity };
}

async function captureJob(
  page: Page,
  baseUrl: string,
  outDir: string,
  job: Job,
  googleFonts: boolean,
): Promise<SwatchRecord[]> {
  const url = new URL(HARNESS_PATH, baseUrl);
  url.searchParams.set('theme', job.theme.id);
  url.searchParams.set('template', job.template.id);
  url.searchParams.set('variants', job.variants.join(','));
  url.searchParams.set('orientation', job.orientation);
  if (googleFonts) url.searchParams.set('fonts', 'google');

  let lastError: unknown;
  for (let attempt = 1; attempt <= CAPTURE_ATTEMPTS; attempt += 1) {
    // Browser-side errors (a layer that throws, a failed media load) would
    // otherwise surface only as a blank or partial frame.
    const consoleErrors: string[] = [];
    const onConsole = (message: { type(): string; text(): string }) => {
      if (message.type() === 'error' && !/favicon/i.test(message.text())) {
        consoleErrors.push(message.text().split('\n')[0].slice(0, 300));
      }
    };
    const onPageError = (error: Error) => {
      consoleErrors.push(`pageerror: ${error.message.split('\n')[0].slice(0, 300)}`);
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    try {
      const state = await loadHarness(page, url.href);
      if (state.error) throw new HarnessError(`${job.theme.id}/${job.template.id}: ${state.error}`);
      const records: SwatchRecord[] = [];
      for (const variantId of job.variants) {
        const result = state.results[variantId];
        if (!result) {
          throw new HarnessError(`${job.theme.id}/${job.template.id}/${variantId}: no result`);
        }
        const dir = path.join(
          outDir,
          safeSegment(job.orientation),
          safeSegment(job.theme.id),
          safeSegment(job.template.id),
        );
        await fs.mkdir(dir, { recursive: true });
        const file = path.join(dir, `${safeSegment(variantId)}.png`);
        await page
          .locator(`section.swatch-frame[data-variant="${variantId}"]`)
          .screenshot({ path: file, animations: 'disabled', scale: 'css', timeout: 20_000 });
        const { issues, severity: measured } = applyExpectations(
          result,
          job.template.bodyExpectation,
        );
        const uniqueErrors = Array.from(new Set(consoleErrors));
        if (uniqueErrors.length > 0) {
          issues.push({
            kind: 'console-error',
            severity: 'warn',
            detail: `${uniqueErrors.length} browser error(s) while rendering: ${uniqueErrors[0]}`,
          });
        }
        const severity =
          uniqueErrors.length > 0 && SEVERITY_RANK[measured] < SEVERITY_RANK.warn
            ? 'warn'
            : measured;
        records.push({
          theme: job.theme.id,
          template: job.template.id,
          variant: variantId,
          orientation: job.orientation,
          path: path.relative(outDir, file).split(path.sep).join('/'),
          applicable: result.applicable,
          bodyExpectation: job.template.bodyExpectation,
          heading: result.heading,
          markdown: result.markdown,
          diagnostics: result.diagnostics,
          minFontPx: result.metrics.minFontPx,
          bodyCoverage: result.metrics.bodyCoverage,
          layerCount: result.metrics.layerCount,
          issues,
          severity,
          ...(uniqueErrors.length > 0 ? { consoleErrors: uniqueErrors } : {}),
        });
      }
      return records;
    } catch (error) {
      if (error instanceof HarnessError) throw error;
      lastError = error;
      if (attempt < CAPTURE_ATTEMPTS) {
        const reason = (error as Error).message.split('\n')[0];
        process.stdout.write(
          `  retry ${attempt + 1}/${CAPTURE_ATTEMPTS}: ${job.theme.id}/${job.template.id} (${reason})\n`,
        );
      }
    } finally {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
    }
  }
  throw lastError;
}

/** Run `items` through `workers` lanes; each lane owns one Playwright page. */
async function runPool<T>(
  items: T[],
  workers: number,
  run: (item: T, lane: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(workers, items.length) }, async (_, lane) => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await run(items[index], lane);
    }
  });
  await Promise.all(lanes);
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildIndexHtml(manifest: Manifest, records: SwatchRecord[], generatedAt: string): string {
  const data = JSON.stringify({
    generatedAt,
    themes: manifest.themes,
    templates: manifest.templates.map(({ id, label, bodyExpectation }) => ({
      id,
      label,
      bodyExpectation,
    })),
    variants: manifest.variants.map(({ id, label }) => ({ id, label })),
    records: records.map((r) => ({
      theme: r.theme,
      template: r.template,
      variant: r.variant,
      orientation: r.orientation,
      path: r.path,
      severity: r.severity,
      applicable: r.applicable,
      coverage: r.bodyCoverage,
      issues: r.issues.map((i) => ({ kind: i.kind, severity: i.severity, detail: i.detail })),
    })),
  }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Squisq Swatches</title>
<style>
  :root { color-scheme: light; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; }
  body { margin: 0; }
  header { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center; padding: 14px 24px; background: #fff; border-bottom: 1px solid #e2e8f0; }
  header h1 { font-size: 18px; margin: 0 12px 0 0; }
  header label { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; color: #334155; }
  select, input[type=search] { font: inherit; padding: 4px 6px; }
  #count { font-size: 13px; color: #64748b; }
  main { padding: 20px 24px; }
  .group { margin-bottom: 36px; }
  .group h2 { font-size: 16px; margin: 0 0 10px; display: flex; gap: 10px; align-items: baseline; }
  .group h2 span { font-size: 12px; color: #64748b; font-weight: 500; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
  .card { border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; overflow: hidden; }
  .card.high { border-color: #dc2626; box-shadow: 0 0 0 2px #fecaca inset; }
  .card.warn { border-color: #d97706; }
  .card img { display: block; width: 100%; aspect-ratio: var(--ar, 16 / 9); object-fit: contain; background: #111827; }
  .meta { padding: 8px 10px; font-size: 12px; display: flex; flex-direction: column; gap: 4px; }
  .meta strong { font-size: 13px; }
  .badges { display: flex; flex-wrap: wrap; gap: 4px; }
  .badge { padding: 1px 6px; border-radius: 999px; font-size: 11px; background: #e2e8f0; color: #334155; }
  .badge.high { background: #fee2e2; color: #991b1b; }
  .badge.warn { background: #ffedd5; color: #9a3412; }
  .badge.info { background: #e0f2fe; color: #075985; }
  details summary { cursor: pointer; color: #475569; }
  details ul { margin: 4px 0 0; padding-left: 16px; color: #475569; }
</style>
</head>
<body>
<header>
  <h1>Squisq Swatches</h1>
  <label>Group by <select id="group"><option value="template">template</option><option value="theme">theme</option><option value="variant">variant</option></select></label>
  <label>Theme <select id="theme"><option value="">all</option></select></label>
  <label>Template <select id="template"><option value="">all</option></select></label>
  <label>Variant <select id="variant"><option value="">all</option></select></label>
  <label>Min severity <select id="severity"><option value="none">any</option><option value="info">info</option><option value="warn">warn</option><option value="high" selected>high</option></select></label>
  <label>Issue <input id="issue" type="search" placeholder="kind or detail" /></label>
  <span id="count"></span>
</header>
<main id="main"></main>
<script id="data" type="application/json">${data}</script>
<script>
(function () {
  const DATA = JSON.parse(document.getElementById('data').textContent);
  const RANK = { none: 0, info: 1, warn: 2, high: 3 };
  const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
  const themes = byId(DATA.themes), templates = byId(DATA.templates), variants = byId(DATA.variants);
  const $ = (id) => document.getElementById(id);
  const fill = (id, list) => { for (const item of list) { const o = document.createElement('option'); o.value = item.id; o.textContent = item.label || item.name || item.id; $(id).appendChild(o); } };
  fill('theme', DATA.themes); fill('template', DATA.templates); fill('variant', DATA.variants);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function render() {
    const group = $('group').value, theme = $('theme').value, template = $('template').value, variant = $('variant').value;
    const minSev = RANK[$('severity').value], needle = $('issue').value.trim().toLowerCase();
    const rows = DATA.records.filter((r) => (!theme || r.theme === theme) && (!template || r.template === template) && (!variant || r.variant === variant)
      && RANK[r.severity] >= minSev && (!needle || r.issues.some((i) => (i.kind + ' ' + i.detail).toLowerCase().includes(needle))));
    const groups = new Map();
    for (const r of rows) { const key = r[group]; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); }
    $('count').textContent = rows.length + ' of ' + DATA.records.length + ' swatches · generated ' + DATA.generatedAt;
    const label = (key) => group === 'template' ? (templates[key]?.label || key) : group === 'theme' ? (themes[key]?.name || key) : (variants[key]?.label || key);
    $('main').innerHTML = Array.from(groups.entries()).map(([key, list]) => '<section class="group"><h2>' + esc(label(key)) + ' <span>' + esc(key) + ' · ' + list.length + '</span></h2><div class="grid">' +
      list.map((r) => {
        const ar = r.orientation === 'portrait' ? '9 / 16' : r.orientation === 'square' ? '1 / 1' : '16 / 9';
        const badges = r.issues.map((i) => '<span class="badge ' + i.severity + '" title="' + esc(i.detail) + '">' + esc(i.kind) + '</span>').join('');
        const details = r.issues.length ? '<details><summary>' + r.issues.length + ' finding(s)</summary><ul>' + r.issues.map((i) => '<li>' + esc(i.detail) + '</li>').join('') + '</ul></details>' : '';
        const cov = r.coverage == null ? '' : ' · body ' + Math.round(r.coverage * 100) + '%';
        return '<article class="card ' + r.severity + '"><a href="' + esc(r.path) + '" target="_blank"><img loading="lazy" style="--ar:' + ar + '" src="' + esc(r.path) + '" alt="' + esc(r.theme + ' ' + r.template + ' ' + r.variant) + '"></a>' +
          '<div class="meta"><strong>' + esc(r.template) + ' · ' + esc(r.variant) + '</strong><span>' + esc(themes[r.theme]?.name || r.theme) + ' · ' + esc(r.orientation) + (r.applicable ? '' : ' · inapplicable') + cov + '</span><div class="badges">' + badges + '</div>' + details + '</div></article>';
      }).join('') + '</div></section>').join('') || '<p>No swatches match the current filters.</p>';
  }
  for (const id of ['group', 'theme', 'template', 'variant', 'severity']) $(id).addEventListener('change', render);
  $('issue').addEventListener('input', render);
  render();
})();
</script>
</body>
</html>
`;
}

function buildSummaryMarkdown(
  manifest: Manifest,
  records: SwatchRecord[],
  generatedAt: string,
  elapsedMs: number,
): string {
  const lines: string[] = [];
  const count = (pred: (r: SwatchRecord) => boolean) => records.filter(pred).length;
  const uniq = (key: (r: SwatchRecord) => string) => new Set(records.map(key)).size;
  lines.push('# Swatch review summary', '');
  lines.push(
    `Generated ${generatedAt} in ${(elapsedMs / 1000).toFixed(0)}s · ${records.length} swatches · ${uniq((r) => r.theme)} themes · ${uniq((r) => r.template)} templates · ${uniq((r) => r.variant)} variants`,
    '',
  );
  lines.push('| Severity | Swatches |', '| --- | ---: |');
  for (const sev of ['high', 'warn', 'info', 'none'] as const) {
    lines.push(`| ${sev} | ${count((r) => r.severity === sev)} |`);
  }
  lines.push('');

  const kinds = new Map<string, { high: number; warn: number; info: number }>();
  for (const r of records) {
    for (const i of r.issues) {
      const entry = kinds.get(i.kind) ?? { high: 0, warn: 0, info: 0 };
      entry[i.severity] += 1;
      kinds.set(i.kind, entry);
    }
  }
  lines.push(
    '## Findings by kind',
    '',
    '| Kind | high | warn | info |',
    '| --- | ---: | ---: | ---: |',
  );
  const sortedKinds = Array.from(kinds.entries()).sort(
    (a, b) => b[1].high - a[1].high || b[1].warn - a[1].warn,
  );
  for (const [kind, c] of sortedKinds)
    lines.push(`| ${kind} | ${c.high} | ${c.warn} | ${c.info} |`);
  lines.push('');

  const tally = (key: (r: SwatchRecord) => string, title: string) => {
    const map = new Map<string, { high: number; warn: number; total: number }>();
    for (const r of records) {
      const k = key(r);
      const e = map.get(k) ?? { high: 0, warn: 0, total: 0 };
      e.total += 1;
      if (r.severity === 'high') e.high += 1;
      if (r.severity === 'warn') e.warn += 1;
      map.set(k, e);
    }
    lines.push(
      `## ${title}`,
      '',
      '| Key | high | warn | swatches |',
      '| --- | ---: | ---: | ---: |',
    );
    const sorted = Array.from(map.entries()).sort(
      (a, b) => b[1].high - a[1].high || b[1].warn - a[1].warn,
    );
    for (const [k, e] of sorted) {
      if (e.high + e.warn === 0) continue;
      lines.push(`| ${k} | ${e.high} | ${e.warn} | ${e.total} |`);
    }
    lines.push('');
  };
  tally((r) => `${r.template} · ${r.variant}`, 'Template × variant with findings');
  tally((r) => r.theme, 'Themes with findings');
  tally((r) => r.template, 'Templates with findings');

  lines.push('## High-severity swatches', '');
  const highs = records.filter((r) => r.severity === 'high');
  if (highs.length === 0) lines.push('None.', '');
  const byTemplate = new Map<string, SwatchRecord[]>();
  for (const r of highs) byTemplate.set(r.template, [...(byTemplate.get(r.template) ?? []), r]);
  for (const [template, list] of byTemplate) {
    const meta = manifest.templates.find((t) => t.id === template);
    lines.push(`### ${meta?.label ?? template} (\`${template}\`) — ${list.length}`, '');
    for (const r of list) {
      const detail = r.issues
        .filter((i) => i.severity === 'high')
        .map((i) => i.detail)
        .join('; ');
      lines.push(`- \`${r.path}\` — ${detail}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

async function writeMontages(
  page: Page,
  baseUrl: string,
  outDir: string,
  manifest: Manifest,
  records: SwatchRecord[],
): Promise<number> {
  const montageDir = path.join(outDir, 'montage');
  await fs.mkdir(montageDir, { recursive: true });
  const groups = new Map<string, SwatchRecord[]>();
  for (const r of records) {
    const key = `${r.orientation}/${r.template}--${r.variant}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const themeName = (id: string) => manifest.themes.find((t) => t.id === id)?.name ?? id;
  const themeIndex = (id: string) => manifest.themes.findIndex((t) => t.id === id);
  const outRel = path.relative(REPO_ROOT, outDir).split(path.sep).join('/');
  let written = 0;
  for (const [key, list] of groups) {
    const [orientation, name] = key.split('/');
    const cell =
      orientation === 'portrait'
        ? { w: 270, h: 480 }
        : orientation === 'square'
          ? { w: 360, h: 360 }
          : { w: 426, h: 240 };
    const cols = orientation === 'portrait' ? 6 : 4;
    const figures = list
      .sort((a, b) => themeIndex(a.theme) - themeIndex(b.theme))
      .map((r) => {
        const flags = r.issues
          .filter((i) => i.severity !== 'info')
          .map((i) => i.kind)
          .join(', ');
        const src = `/${path.posix.join(outRel, r.path)}`;
        return `<figure class="${r.severity}"><img src="${src}" alt=""><figcaption><b>${escapeHtml(themeName(r.theme))}</b>${flags ? ` <i>${escapeHtml(flags)}</i>` : ''}</figcaption></figure>`;
      })
      .join('');
    const html = `<!doctype html><html><head><meta charset="UTF-8"><style>
      body{margin:0;background:#0b1220;color:#e2e8f0;font:12px system-ui,sans-serif}
      h1{margin:0;padding:10px 14px;font-size:15px;font-weight:600}
      .grid{display:grid;grid-template-columns:repeat(${cols},${cell.w}px);gap:10px;padding:0 14px 14px}
      figure{margin:0;border:2px solid transparent;border-radius:6px;overflow:hidden;background:#111827}
      figure.high{border-color:#ef4444} figure.warn{border-color:#f59e0b}
      img{display:block;width:${cell.w}px;height:${cell.h}px;object-fit:contain}
      figcaption{padding:4px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} figcaption i{color:#fca5a5;font-style:normal}
    </style></head><body><h1>${escapeHtml(name)} · ${escapeHtml(orientation)}</h1><div class="grid">${figures}</div></body></html>`;
    const htmlFile = path.join(
      montageDir,
      `${safeSegment(orientation)}--${safeSegment(name)}.html`,
    );
    await fs.writeFile(htmlFile, html);
    const url = `${baseUrl}/${path.relative(REPO_ROOT, htmlFile).split(path.sep).join('/')}`;
    await page.setViewportSize({ width: cols * (cell.w + 10) + 28, height: 600 });
    await page.goto(url, { waitUntil: 'load' });
    await page.screenshot({
      path: htmlFile.replace(/\.html$/, '.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await fs.rm(htmlFile);
    written += 1;
  }
  return written;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const started = Date.now();
  const outDir = resolveOutputDir(options.outDir);
  const { server, baseUrl } = await createHarnessServer();
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      deviceScaleFactor: 1,
    });

    // Keep captures deterministic and offline: only the harness origin (and,
    // when asked for, Google Fonts through an in-memory cache) may load.
    const fontCache = new Map<
      string,
      { status: number; headers: Record<string, string>; body: Buffer }
    >();
    let blocked = 0;
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === baseUrl) return route.continue();
      if (options.googleFonts && /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
        const hit = fontCache.get(url.href);
        if (hit) return route.fulfill(hit);
        try {
          const response = await route.fetch();
          const entry = {
            status: response.status(),
            headers: response.headers(),
            body: await response.body(),
          };
          if (entry.status === 200) fontCache.set(url.href, entry);
          return route.fulfill(entry);
        } catch {
          return route.abort();
        }
      }
      blocked += 1;
      return route.abort();
    });

    const manifestPage = await context.newPage();
    const manifest = await readManifest(manifestPage, baseUrl);

    if (options.list) {
      const ids = <T extends { id: string }>(items: T[]) => items.map((i) => i.id).join(', ');
      process.stdout.write(`Themes (${manifest.themes.length}): ${ids(manifest.themes)}\n`);
      process.stdout.write(
        `Templates (${manifest.templates.length}): ${ids(manifest.templates)}\n`,
      );
      process.stdout.write(`Variants (${manifest.variants.length}): ${ids(manifest.variants)}\n`);
      return;
    }

    const themes = filterIds(manifest.themes, options.themes, 'theme');
    const templates = filterIds(manifest.templates, options.templates, 'template');
    const variantFilter = filterIds(manifest.variants, options.variants, 'variant').map(
      (v) => v.id,
    );

    const jobs: Job[] = [];
    let skippedInapplicable = 0;
    for (const orientation of options.orientations) {
      for (const theme of themes) {
        for (const template of templates) {
          const applicable = new Set(template.applicableVariants);
          const wanted = variantFilter.filter((v) => options.allVariants || applicable.has(v));
          skippedInapplicable += variantFilter.length - wanted.length;
          for (let i = 0; i < wanted.length; i += VARIANTS_PER_PAGE) {
            jobs.push({
              theme,
              template,
              orientation,
              variants: wanted.slice(i, i + VARIANTS_PER_PAGE),
            });
          }
        }
      }
    }
    const totalSwatches = jobs.reduce((n, j) => n + j.variants.length, 0);
    process.stdout.write(
      `Rendering ${totalSwatches} swatches (${themes.length} themes × ${templates.length} templates, ${options.orientations.join('/')}) with ${options.workers} worker(s)` +
        (skippedInapplicable
          ? `; skipping ${skippedInapplicable} inapplicable combinations (pass --all-variants to include)`
          : '') +
        `\n`,
    );

    if (!options.keep) await fs.rm(outDir, { recursive: true, force: true });
    await fs.mkdir(outDir, { recursive: true });

    const records: SwatchRecord[] = [];
    const failures: string[] = [];
    let done = 0;
    const pages: Page[] = [];
    for (let i = 0; i < Math.min(options.workers, jobs.length); i += 1) {
      pages.push(await context.newPage());
    }

    await runPool(jobs, options.workers, async (job, lane) => {
      const page = pages[lane];
      try {
        const result = await captureJob(page, baseUrl, outDir, job, options.googleFonts);
        records.push(...result);
      } catch (error) {
        const reason = (error as Error).message.split('\n')[0];
        failures.push(`${job.theme.id}/${job.template.id} [${job.variants.join(',')}]: ${reason}`);
      }
      done += job.variants.length;
      const highs = records.filter((r) => r.severity === 'high').length;
      process.stdout.write(
        `  ${done}/${totalSwatches} · ${job.theme.id}/${job.template.id} (${job.variants.length}) · ${highs} high so far\n`,
      );
    });

    // --keep is an incremental re-run: carry forward every swatch that was not
    // re-rendered this time so the reports still describe the whole matrix.
    if (options.keep) {
      const key = (r: SwatchRecord) => `${r.orientation}/${r.theme}/${r.template}/${r.variant}`;
      const rendered = new Set(records.map(key));
      try {
        const previous = JSON.parse(
          await fs.readFile(path.join(outDir, 'manifest.json'), 'utf8'),
        ) as { records?: SwatchRecord[] };
        let carried = 0;
        for (const r of previous.records ?? []) {
          if (rendered.has(key(r)) || !existsSync(path.join(outDir, r.path))) continue;
          records.push(r);
          carried += 1;
        }
        if (carried > 0) {
          process.stdout.write(`  carried ${carried} swatch(es) forward from the previous run\n`);
        }
      } catch {
        // No previous manifest — nothing to merge.
      }
    }

    const orderOf = <T extends { id: string }>(items: T[], id: string) =>
      items.findIndex((i) => i.id === id);
    records.sort(
      (a, b) =>
        options.orientations.indexOf(a.orientation) - options.orientations.indexOf(b.orientation) ||
        orderOf(manifest.themes, a.theme) - orderOf(manifest.themes, b.theme) ||
        orderOf(manifest.templates, a.template) - orderOf(manifest.templates, b.template) ||
        orderOf(manifest.variants, a.variant) - orderOf(manifest.variants, b.variant),
    );

    const generatedAt = new Date().toISOString();
    const elapsed = Date.now() - started;
    await fs.writeFile(
      path.join(outDir, 'manifest.json'),
      `${JSON.stringify(
        {
          generatedAt,
          options: { ...options, outDir },
          orientations: manifest.orientations,
          themes,
          templates,
          variants: manifest.variants,
          records,
          failures,
        },
        null,
        2,
      )}\n`,
    );
    await fs.writeFile(
      path.join(outDir, 'issues.json'),
      `${JSON.stringify(
        records
          .filter((r) => r.issues.length > 0)
          .map(
            ({
              theme,
              template,
              variant,
              orientation,
              path: p,
              severity,
              applicable,
              bodyCoverage,
              issues,
            }) => ({
              theme,
              template,
              variant,
              orientation,
              path: p,
              severity,
              applicable,
              bodyCoverage,
              issues,
            }),
          ),
        null,
        2,
      )}\n`,
    );
    await fs.writeFile(
      path.join(outDir, 'index.html'),
      buildIndexHtml(manifest, records, generatedAt),
    );
    await fs.writeFile(
      path.join(outDir, 'summary.md'),
      buildSummaryMarkdown(manifest, records, generatedAt, elapsed),
    );

    let montages = 0;
    if (options.montage) {
      montages = await writeMontages(manifestPage, baseUrl, outDir, manifest, records);
    }

    const highs = records.filter((r) => r.severity === 'high').length;
    const warns = records.filter((r) => r.severity === 'warn').length;
    process.stdout.write(
      `\nWrote ${records.length} swatches to ${outDir} in ${(elapsed / 1000).toFixed(0)}s\n`,
    );
    process.stdout.write(
      `  ${highs} high, ${warns} warn · ${blocked} external request(s) blocked${montages ? ` · ${montages} montage(s)` : ''}\n`,
    );
    process.stdout.write(
      `  Review: ${path.join(outDir, 'summary.md')} and ${path.join(outDir, 'index.html')}\n`,
    );
    if (failures.length > 0) {
      process.stdout.write(
        `\n${failures.length} job(s) failed:\n${failures.map((f) => `  - ${f}`).join('\n')}\n`,
      );
      process.exitCode = 1;
    }
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
