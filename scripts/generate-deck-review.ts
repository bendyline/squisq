/**
 * Render whole documents as dynamic-slides decks, one PNG per slide, plus a
 * contact sheet per deck, so a reviewer (human or agent) can judge a deck the
 * way an audience sees it: its beauty, its faithfulness to the document, and
 * how well its visuals explain the ideas.
 *
 *   npm run screenshots:decks
 *   npm run screenshots:decks -- --theme warm-earth,documentary --density section
 *   npm run screenshots:decks -- --doc reports/deck-review/corpus-local/tonga.md
 *   npm run screenshots:decks -- --out reports/deck-review/after-typography
 *
 * Documents default to the public-domain corpus in scripts/deck-review/corpus
 * plus any local documents in reports/deck-review/corpus-local (gitignored).
 * A `<name>.hints.json` beside a document stands in for the designer's saved
 * choices (AI wording, layout preferences); otherwise the document's own hints
 * or the defaults apply.
 *
 * Output (gitignored): reports/deck-review/latest/
 *   <doc>/<theme>/slide-NN.png      every slide at 1280×720
 *   <doc>/<theme>/contact.png       the deck at a glance
 *   <doc>/<theme>/deck.json         the plan, templates and measurements
 *   summary.md                      per-deck measurements: type sizes, issues
 *
 * Like the swatch harness, pages render workspace source through Vite aliases
 * (scripts/harness-server.ts), so planner, template and theme edits show on the
 * next run without rebuilding a package.
 */
import { chromium, type Page } from '@playwright/test';
import type { Plugin } from 'vite';
import fs from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHarnessServer, REPO_ROOT } from './harness-server.js';

const HARNESS_PATH = '/scripts/deck-review/index.html';
const CORPUS_DIRS = [
  path.join(REPO_ROOT, 'scripts', 'deck-review', 'corpus'),
  path.join(REPO_ROOT, 'reports', 'deck-review', 'corpus-local'),
];
const DEFAULT_OUT_DIR = 'reports/deck-review/latest';
const DEFAULT_THEMES = ['warm-earth', 'documentary'];

interface Options {
  docs: string[];
  themes: string[];
  density?: string;
  /** Folder of `<doc>.hints.json` files, instead of the ones beside each doc. */
  hintsDir?: string;
  outDir: string;
  help: boolean;
}

interface SlideMetrics {
  minFontPx: number | null;
  issues: Array<{ kind: string; severity: string; detail: string }>;
  layers: Array<{ kind: string; fontPx?: number; visible: boolean; textLength: number }>;
}

interface DeckSlide {
  index: number;
  id: string;
  template: string;
  sourceBlockId?: string;
  layout?: string;
  headline?: string;
  points?: string[];
  media?: string[];
  metrics?: SlideMetrics;
}

interface DeckState {
  ready: boolean;
  error?: string;
  theme?: string;
  density?: string;
  diagnostics?: string[];
  slides?: DeckSlide[];
}

function usage(): string {
  return `Render documents as dynamic-slides decks for visual review.

  npm run screenshots:decks [-- options]

  --doc <file|dir>[,…]   documents to render (default: the deck-review corpora)
  --theme <id>[,…]       themes (default: ${DEFAULT_THEMES.join(',')})
  --density <d>          concise | balanced | detailed | section (default: each doc's own)
  --hints <dir>          read <doc>.hints.json from this folder (e.g. AI suggestions)
  --out <dir>            output folder (default: ${DEFAULT_OUT_DIR})
`;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    docs: [],
    themes: DEFAULT_THEMES,
    outDir: DEFAULT_OUT_DIR,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => {
      const next = argv[++i];
      if (!next) throw new Error(`${arg} needs a value.`);
      return next;
    };
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--doc') options.docs.push(...value().split(','));
    else if (arg === '--theme') options.themes = value().split(',').filter(Boolean);
    else if (arg === '--density') options.density = value();
    else if (arg === '--out') options.outDir = value();
    else if (arg === '--hints') options.hintsDir = path.resolve(REPO_ROOT, value());
    else throw new Error(`Unknown option ${arg}\n\n${usage()}`);
  }
  return options;
}

async function collectDocs(requested: string[]): Promise<Map<string, string>> {
  const sources = requested.length ? requested.map((p) => path.resolve(REPO_ROOT, p)) : CORPUS_DIRS;
  const docs = new Map<string, string>();
  for (const source of sources) {
    if (!existsSync(source)) continue;
    const files = statSync(source).isDirectory()
      ? (await fs.readdir(source)).filter((f) => f.endsWith('.md')).map((f) => path.join(source, f))
      : [source];
    for (const file of files) docs.set(path.basename(file, '.md'), file);
  }
  return docs;
}

/** Serve each document, and its optional hints sidecar, under /deck-review-docs. */
function docsPlugin(docs: Map<string, string>, hintsDir?: string): Plugin {
  return {
    name: 'squisq-deck-review-docs',
    configureServer(server) {
      server.middlewares.use('/deck-review-docs', async (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '/').split('?')[0]!.replace(/^\//, ''));
        const hints = name.endsWith('.hints.json');
        const file = docs.get(hints ? name.slice(0, -'.hints.json'.length) : name);
        const target =
          file &&
          (hints
            ? hintsDir
              ? path.join(hintsDir, name)
              : file.replace(/\.md$/, '.hints.json')
            : file);
        if (!target || !existsSync(target)) return next();
        res.setHeader('Content-Type', hints ? 'application/json' : 'text/markdown; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(await fs.readFile(target));
      });
    },
  };
}

async function renderDeck(page: Page, url: string): Promise<DeckState> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 240_000 });
  await page.waitForFunction(
    () =>
      (window as Window & { __SQUISQ_DECK_REVIEW__?: DeckState }).__SQUISQ_DECK_REVIEW__?.ready ===
      true,
    undefined,
    { timeout: 240_000 },
  );
  return page.evaluate(
    () => (window as Window & { __SQUISQ_DECK_REVIEW__?: DeckState }).__SQUISQ_DECK_REVIEW__!,
  );
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}

/** Distinct rendered type sizes (viewport px) of a slide's visible text. */
function fontSizes(slide: DeckSlide): number[] {
  const sizes = (slide.metrics?.layers ?? [])
    .filter((layer) => layer.visible && layer.textLength > 0 && layer.fontPx)
    .map((layer) => Math.round(layer.fontPx!));
  return [...new Set(sizes)].sort((a, b) => b - a);
}

function contactSheetHtml(title: string, slides: DeckSlide[]): string {
  const cells = slides
    .map(
      (slide) =>
        `<figure><img src="slide-${String(slide.index + 1).padStart(2, '0')}.png"><figcaption>${slide.index + 1}. ${escapeHtml(
          `${slide.template}${slide.layout ? ` · ${slide.layout}` : ''}`,
        )}</figcaption></figure>`,
    )
    .join('');
  return `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:16px;background:#1b1b1f;font:14px system-ui;color:#ddd;width:1648px}
h1{font-size:18px;margin:0 0 12px}
main{display:grid;grid-template-columns:repeat(3,544px);gap:8px}
figure{margin:0}img{width:544px;height:306px;display:block;border:1px solid #333}
figcaption{padding:2px 0 6px;color:#aaa}
</style><h1>${escapeHtml(title)}</h1><main>${cells}</main>`;
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const docs = await collectDocs(options.docs);
  if (!docs.size) throw new Error('No documents to render.');
  const outDir = path.resolve(REPO_ROOT, options.outDir);
  await fs.mkdir(outDir, { recursive: true });
  const { server, baseUrl } = await createHarnessServer([docsPlugin(docs, options.hintsDir)]);
  const browser = await chromium.launch();
  const summary: string[] = [
    '| Deck | Slides | Templates | Type sizes (px @1080p) | Smallest | High / warn issues |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  try {
    const page = await browser.newPage({ viewport: { width: 1320, height: 900 } });
    for (const [name] of docs) {
      for (const theme of options.themes) {
        const params = new URLSearchParams({ doc: name, theme });
        if (options.density) params.set('density', options.density);
        const state = await renderDeck(page, `${baseUrl}${HARNESS_PATH}?${params}`);
        const deckDir = path.join(outDir, name, theme);
        await fs.mkdir(deckDir, { recursive: true });
        if (state.error || !state.slides) {
          process.stderr.write(`${name}/${theme}: ${state.error ?? 'no slides'}\n`);
          continue;
        }
        for (const slide of state.slides) {
          await page.locator(`section.deck-slide[data-index="${slide.index}"]`).screenshot({
            path: path.join(deckDir, `slide-${String(slide.index + 1).padStart(2, '0')}.png`),
            animations: 'disabled',
          });
        }
        const contact = path.join(deckDir, 'contact.html');
        await fs.writeFile(
          contact,
          contactSheetHtml(`${name} · ${theme} · ${state.density}`, state.slides),
        );
        const sheet = await browser.newPage({ viewport: { width: 1680, height: 900 } });
        await sheet.goto(
          `${baseUrl}/${path.relative(REPO_ROOT, contact).split(path.sep).join('/')}`,
          {
            waitUntil: 'load',
          },
        );
        await sheet.screenshot({ path: path.join(deckDir, 'contact.png'), fullPage: true });
        await sheet.close();
        await fs.writeFile(path.join(deckDir, 'deck.json'), JSON.stringify(state, null, 2));

        const sizes = new Set(state.slides.flatMap(fontSizes));
        const smallest = Math.min(...state.slides.map((s) => s.metrics?.minFontPx ?? Infinity));
        const issues = state.slides.flatMap((s) => s.metrics?.issues ?? []);
        const templates = [...new Set(state.slides.map((s) => s.template))].join(', ');
        summary.push(
          `| ${name} / ${theme} | ${state.slides.length} | ${templates} | ${[...sizes]
            .sort((a, b) => b - a)
            .join(' ')} | ${Number.isFinite(smallest) ? Math.round(smallest) : '–'} | ${
            issues.filter((i) => i.severity === 'high').length
          } / ${issues.filter((i) => i.severity === 'warn').length} |`,
        );
        process.stdout.write(`${name}/${theme}: ${state.slides.length} slides\n`);
      }
    }
    await fs.writeFile(path.join(outDir, 'summary.md'), `${summary.join('\n')}\n`);
    process.stdout.write(`Wrote ${path.relative(REPO_ROOT, outDir)}\n`);
  } finally {
    await browser.close();
    await server.close();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
