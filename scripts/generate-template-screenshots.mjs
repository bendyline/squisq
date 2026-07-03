#!/usr/bin/env node
import { chromium } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const HARNESS_PATH = '/scripts/template-screenshots/index.html';
const DEFAULT_OUT_DIR = 'reports/template-screenshots/latest';

function usage() {
  return `Generate screenshots for every built-in block template across every built-in theme.

Usage:
  npm run screenshots:templates
  npm run screenshots:templates -- --theme standard,bold --template title,list
  npm run screenshots:templates -- --out reports/template-screenshots/experiment

Options:
  --out <dir>        Output directory, relative to the repo root by default.
  --theme <ids>      Optional comma-separated theme id filter. May be repeated.
  --template <ids>   Optional comma-separated template id filter. May be repeated.
  --help             Show this message.
`;
}

function parseArgs(args) {
  const options = {
    outDir: DEFAULT_OUT_DIR,
    themes: [],
    templates: [],
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--out') {
      i += 1;
      options.outDir = readOptionValue(args, i, arg);
      continue;
    }
    if (arg === '--theme') {
      i += 1;
      options.themes.push(...splitIdList(readOptionValue(args, i, arg)));
      continue;
    }
    if (arg === '--template') {
      i += 1;
      options.templates.push(...splitIdList(readOptionValue(args, i, arg)));
      continue;
    }
    throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
  }

  return options;
}

function readOptionValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function splitIdList(value) {
  return value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function workspaceSourceAliases() {
  const src = (...segments) => path.join(REPO_ROOT, ...segments);
  return [
    {
      find: /^@bendyline\/squisq-react\/styles$/,
      replacement: src('packages/react/src/styles/index.css'),
    },
    {
      find: /^@bendyline\/squisq-react$/,
      replacement: src('packages/react/src/index.ts'),
    },
    {
      find: /^@bendyline\/squisq\/schemas$/,
      replacement: src('packages/core/src/schemas/index.ts'),
    },
    {
      find: /^@bendyline\/squisq\/doc$/,
      replacement: src('packages/core/src/doc/index.ts'),
    },
    {
      find: /^@bendyline\/squisq\/markdown$/,
      replacement: src('packages/core/src/markdown/index.ts'),
    },
    {
      find: /^@bendyline\/squisq\/icon-marker$/,
      replacement: src('packages/core/src/icons/inlineIconMarker.ts'),
    },
    {
      find: /^@bendyline\/squisq$/,
      replacement: src('packages/core/src/index.ts'),
    },
  ];
}

async function createHarnessServer() {
  const server = await createServer({
    root: REPO_ROOT,
    configFile: false,
    appType: 'mpa',
    logLevel: 'warn',
    plugins: [react()],
    resolve: {
      alias: workspaceSourceAliases(),
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
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
    },
  });

  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    await server.close();
    throw new Error('Unable to resolve Vite server address.');
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function readManifest(page, baseUrl) {
  await page.goto(`${baseUrl}${HARNESS_PATH}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__SQUISQ_TEMPLATE_SCREENSHOT__?.ready === true);

  const state = await page.evaluate(() => window.__SQUISQ_TEMPLATE_SCREENSHOT__);
  if (!state?.manifest) throw new Error('Screenshot harness did not expose a manifest.');
  if (state.error) throw new Error(state.error);
  return state.manifest;
}

function filterByIds(items, ids, kind) {
  if (ids.length === 0) return items;

  const idSet = new Set(ids);
  const known = new Set(items.map((item) => item.id));
  const unknown = [...idSet].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown ${kind} id(s): ${unknown.join(', ')}`);
  }

  return items.filter((item) => idSet.has(item.id));
}

function sanitizePathSegment(value) {
  return value.replace(/[^a-z0-9._-]+/gi, '-');
}

function resolveOutputDir(outDir) {
  const resolved = path.isAbsolute(outDir) ? outDir : path.resolve(REPO_ROOT, outDir);
  const relative = path.relative(REPO_ROOT, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Refusing to clean an output directory outside the repository.');
  }
  return resolved;
}

async function prepareOutputDir(outDir) {
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
}

const CAPTURE_ATTEMPTS = 3;

async function captureScreenshot(page, baseUrl, outDir, theme, template) {
  const themeSegment = sanitizePathSegment(theme.id);
  const templateSegment = sanitizePathSegment(template.id);
  const relativePath = `${themeSegment}/${templateSegment}.png`;
  const screenshotPath = path.join(outDir, relativePath);

  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
  const url = new URL(HARNESS_PATH, baseUrl);
  url.searchParams.set('theme', theme.id);
  url.searchParams.set('template', template.id);

  // Individual captures can time out transiently (slow font fetch, busy
  // machine stalling element-stability checks), so retry a couple of
  // times before failing the whole 253-shot run.
  let lastError;
  for (let attempt = 1; attempt <= CAPTURE_ATTEMPTS; attempt += 1) {
    try {
      await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__SQUISQ_TEMPLATE_SCREENSHOT__?.ready === true);

      const state = await page.evaluate(() => window.__SQUISQ_TEMPLATE_SCREENSHOT__);
      if (state?.error) {
        // Harness-reported errors are deterministic — retrying won't help.
        throw new HarnessError(`${theme.id}/${template.id}: ${state.error}`);
      }

      await page.locator('#template-screenshot-frame').screenshot({
        path: screenshotPath,
        animations: 'disabled',
      });

      return relativePath;
    } catch (err) {
      if (err instanceof HarnessError) throw err;
      lastError = err;
      if (attempt < CAPTURE_ATTEMPTS) {
        process.stdout.write(
          `Retrying ${theme.id}/${template.id} (attempt ${attempt + 1}/${CAPTURE_ATTEMPTS})\n`,
        );
      }
    }
  }
  throw lastError;
}

class HarnessError extends Error {}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildIndexHtml({ generatedAt, manifest, themes, templates, screenshots }) {
  const imageByKey = new Map(
    screenshots.map((shot) => [`${shot.themeId}/${shot.templateId}`, shot.path]),
  );

  const sections = themes
    .map((theme) => {
      const cards = templates
        .map((template) => {
          const imagePath = imageByKey.get(`${theme.id}/${template.id}`);
          if (!imagePath) return '';
          return `<article class="card">
            <a href="${escapeHtml(imagePath)}">
              <img src="${escapeHtml(imagePath)}" alt="${escapeHtml(`${theme.name} ${template.label}`)}" loading="lazy" />
            </a>
            <div class="caption">
              <strong>${escapeHtml(template.label)}</strong>
              <span>${escapeHtml(template.id)}</span>
            </div>
          </article>`;
        })
        .join('\n');

      return `<section class="theme-section">
        <h2>${escapeHtml(theme.name)} <span>${escapeHtml(theme.id)}</span></h2>
        <div class="grid">${cards}</div>
      </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Squisq Template Screenshots</title>
    <style>
      :root {
        color-scheme: light;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f8fafc;
        color: #0f172a;
      }
      body {
        margin: 0;
      }
      header {
        padding: 32px;
        border-bottom: 1px solid #e2e8f0;
        background: #ffffff;
      }
      h1,
      h2,
      p {
        margin: 0;
      }
      h1 {
        font-size: 28px;
        line-height: 1.2;
      }
      header p {
        margin-top: 8px;
        color: #475569;
      }
      main {
        padding: 32px;
      }
      .theme-section + .theme-section {
        margin-top: 48px;
      }
      h2 {
        display: flex;
        gap: 12px;
        align-items: baseline;
        margin-bottom: 16px;
        font-size: 22px;
      }
      h2 span,
      .caption span {
        color: #64748b;
        font-size: 13px;
        font-weight: 500;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 18px;
      }
      .card {
        overflow: hidden;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #ffffff;
      }
      img {
        display: block;
        width: 100%;
        aspect-ratio: ${manifest.cssSize.width} / ${manifest.cssSize.height};
        object-fit: cover;
        background: #111827;
      }
      .caption {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Squisq Template Screenshots</h1>
      <p>Generated ${escapeHtml(generatedAt)} · ${themes.length} theme(s) · ${templates.length} template(s) · ${screenshots.length} screenshot(s)</p>
    </header>
    <main>${sections}</main>
  </body>
</html>`;
}

async function writeReport(outDir, manifest, themes, templates, screenshots) {
  const generatedAt = new Date().toISOString();
  await fs.writeFile(
    path.join(outDir, 'manifest.json'),
    `${JSON.stringify(
      {
        generatedAt,
        viewport: manifest.viewport,
        cssSize: manifest.cssSize,
        themes,
        templates,
        screenshots,
      },
      null,
      2,
    )}\n`,
  );
  await fs.writeFile(
    path.join(outDir, 'index.html'),
    buildIndexHtml({ generatedAt, manifest, themes, templates, screenshots }),
  );
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const outDir = resolveOutputDir(options.outDir);
  const { server, baseUrl } = await createHarnessServer();
  let browser;

  try {
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    // Serve Google Fonts from an in-process cache after the first fetch.
    // Every navigation re-requests the theme's stylesheet + faces; across a
    // 253-shot run those hundreds of network round-trips get throttled and
    // stall captures. One fetch per unique URL, then memory.
    const fontCache = new Map();
    await page.route(
      (url) => /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname),
      async (route) => {
        const key = route.request().url();
        const hit = fontCache.get(key);
        if (hit) {
          await route.fulfill({ status: hit.status, headers: hit.headers, body: hit.body });
          return;
        }
        try {
          const response = await route.fetch();
          const entry = {
            status: response.status(),
            headers: response.headers(),
            body: await response.body(),
          };
          if (entry.status === 200) fontCache.set(key, entry);
          await route.fulfill(entry);
        } catch {
          // Offline or blocked — let the harness fall back to system faces.
          await route.abort();
        }
      },
    );

    const manifest = await readManifest(page, baseUrl);

    if (manifest.missingFixtureIds.length > 0) {
      throw new Error(
        `Missing screenshot fixtures for template(s): ${manifest.missingFixtureIds.join(', ')}`,
      );
    }

    const themes = filterByIds(manifest.themes, options.themes, 'theme');
    const templates = filterByIds(manifest.templates, options.templates, 'template');
    const total = themes.length * templates.length;
    const screenshots = [];

    await prepareOutputDir(outDir);

    let count = 0;
    for (const theme of themes) {
      for (const template of templates) {
        const relativePath = await captureScreenshot(page, baseUrl, outDir, theme, template);
        screenshots.push({
          themeId: theme.id,
          templateId: template.id,
          path: relativePath,
        });
        count += 1;
        process.stdout.write(`Captured ${count}/${total}: ${theme.id}/${template.id}\n`);
      }
    }

    await writeReport(outDir, manifest, themes, templates, screenshots);
    process.stdout.write(`\nWrote ${screenshots.length} screenshots to ${outDir}\n`);
    process.stdout.write(`Open ${path.join(outDir, 'index.html')} to browse the contact sheet.\n`);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

run().catch((err) => {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
