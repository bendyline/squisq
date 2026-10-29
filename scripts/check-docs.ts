/**
 * Build the documentation site and report problems.
 *
 *   npm run docs:check                       # report broken links, failed examples
 *   npm run docs:check -- --out <dir>        # also write the site (beside public/)
 *   npm run docs:check -- --layers <page>    # print each example's rendered layers
 *
 * `--out` writes the docs into `<dir>/docs/` and copies the site's public
 * folder into `<dir>`, so `<dir>` can be served as-is to look at the pages.
 * `--layers blocks/quote.md` lists, per live example on that page, the
 * template each block resolved to and the layers it draws — a quick way to
 * confirm an example shows what it claims to without opening a browser.
 *
 * Needs built packages (`npm run build`), like the site itself.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { buildPreviewDoc, markdownToDoc, materializeBlockLayers } from '@bendyline/squisq/doc';
import { isTemplateBlock, type Block, type Doc } from '@bendyline/squisq/schemas';
import { buildDocsSite } from '../packages/site/src/docsSite/buildDocsSite';
import { nodeDocsSource } from '../packages/site/src/docsSite/nodeDocsSource';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const layersPage = option('--layers');
if (layersPage) {
  printLayers(layersPage);
  process.exit(0);
}

const { PLAYER_BUNDLE } = await import('@bendyline/squisq-react/standalone-source');
const started = Date.now();
const result = buildDocsSite({ source: nodeDocsSource(repoDir), playerScript: PLAYER_BUNDLE });
const previews = result.pages.reduce((sum, page) => sum + page.previews, 0);
console.log(
  `Built ${result.pages.length} pages with ${previews} live examples in ${Date.now() - started} ms.`,
);

const out = option('--out');
if (out) {
  const root = path.resolve(out);
  fs.rmSync(path.join(root, 'docs'), { recursive: true, force: true });
  fs.cpSync(path.join(repoDir, 'packages/site/public'), root, { recursive: true });
  for (const [relative, contents] of result.files) {
    const destination = path.join(root, 'docs', ...relative.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, contents);
  }
  console.log(`Wrote ${result.files.size} files to ${path.join(root, 'docs')}.`);
}

if (result.problems.length === 0) {
  console.log('No problems.');
} else {
  for (const problem of result.problems) console.log(`  ${problem.page}: ${problem.message}`);
  console.log(`${result.problems.length} problem(s).`);
  process.exitCode = 1;
}

function printLayers(page: string): void {
  const file = path.join(repoDir, 'docs', page);
  const text = fs.readFileSync(file, 'utf8');
  // Three or more backticks, closed by the same run (a snippet may hold a fence of its own).
  const fence = /^(`{3,})(?:markdown|md)[ \t]+([^\n]*\bpreview\b[^\n]*)\n([\s\S]*?)^\1[ \t]*$/gm;
  let index = 0;
  for (const match of text.matchAll(fence)) {
    index += 1;
    const meta = match[2];
    const snippet = match[3];
    const mode = /preview=(\w+)/.exec(meta)?.[1] ?? 'slideshow';
    console.log(`\n── Example ${index} (${mode}) ──`);
    let doc: Doc = markdownToDoc(parseMarkdown(snippet));
    if (mode === 'slideshow') doc = buildPreviewDoc(doc);
    for (const block of doc.blocks) describeBlock(block, doc, '');
  }
  if (index === 0) console.log('No live examples on that page.');
}

function describeBlock(block: Block, doc: Doc, indent: string): void {
  const template = isTemplateBlock(block) ? block.template : (block.template ?? '(none)');
  console.log(`${indent}block "${block.id}" → template ${template}`);
  try {
    const result = materializeBlockLayers(block, {
      persistentLayers: false,
      customTemplates: doc.customTemplates,
    });
    console.log(`${indent}  (source: ${result.source})`);
    for (const layer of result.layers) {
      const content = 'content' in layer ? layer.content : undefined;
      console.log(`${indent}  ${layer.type.padEnd(8)} ${layer.id}  ${summarize(content)}`);
    }
    if (result.diagnostic) console.log(`${indent}  ! ${JSON.stringify(result.diagnostic)}`);
  } catch (err: unknown) {
    console.log(`${indent}  ! ${err instanceof Error ? err.message : String(err)}`);
  }
}

function summarize(content: unknown): string {
  if (!content || typeof content !== 'object') return '';
  const record = content as Record<string, unknown>;
  if (typeof record.text === 'string') return JSON.stringify(record.text.slice(0, 70));
  if ('src' in record) return `src=${JSON.stringify(record.src ?? null)}`;
  const keys = Object.keys(record).slice(0, 4).join(',');
  return keys ? `{${keys}}` : '';
}
