---
title: Static sites
description: Publish Markdown as HTML pages, placed in your own page template or bundled as a linked site.
---

# Static sites

Squisq renders Markdown to HTML two ways:

- **Plain HTML** — semantic, script-free pages (`<h1>`, `<p>`, `<table>`, `<img>`) that you can
  style and place inside your own site template. This is what you want for a blog, a handbook, or
  documentation.
- **Player-backed HTML** — a page that embeds the standalone player and renders the document as a
  scrolling page or a slideshow, with every block template drawn. This is what you want for a
  presentation or a richly laid-out report.

Both run in Node and the browser, and both come from `@bendyline/squisq-formats/html`.

## Render one page

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownDocToPlainHtml } from '@bendyline/squisq-formats/html';

const doc = parseMarkdown(await readFile('spring-survey.md', 'utf8'));
const html = markdownDocToPlainHtml(doc, { title: 'Spring survey results', themeId: 'warm-earth' });
await writeFile('spring-survey.html', html);
```

`markdownDocToPlainHtml(doc, options?)` returns a complete HTML document: a `<head>` with a
stylesheet and the rendered body. Footnotes become a numbered notes section, hosted-video links
become players, and ` ```svg ` fences become sanitized images. An audio or video file — written
as an image (`![Launch clip](clip.mp4)`) or as a standalone `{[audio src=…]}` / `{[video src=…]}`
tag — becomes a native player. Other block tags are left out rather than printed: a paragraph
that is only a tag (`{[quote]}`), and the single tag at the end of an unannotated section, on its
own line or glued to the last sentence (`Revenue grew 40% {[statHighlight]}`), which the player
reads as that section's template.

| Option              | Type                                 | Effect                                                                                         |
| ------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `title`             | `string`                             | The page `<title>` (default `'Document'`)                                                      |
| `theme` / `themeId` | `Theme` / `string`                   | Colors and typography for the page; falls back to the document's `squisq-theme` frontmatter    |
| `themeRegistry`     | `ThemeRegistry`                      | Your own themes, for a `themeId` that isn't built in                                           |
| `links`             | `Map<string, string>`                | Rewrites link `href`s, keyed by the URL exactly as written — use it to turn `.md` into `.html` |
| `images`            | `Map<string, string>`                | Rewrites image `src`s, keyed the same way — use it to point at a CDN or a hashed filename      |
| `htmlPolicy`        | `'sanitize'`, `'strip'`, `'trusted'` | Raw HTML in the Markdown: cleaned (default), removed, or passed through                        |
| `externalResources` | `'deny'` or `'allow'`                | Whether the page may load Google Fonts and the Font Awesome stylesheet (default `'deny'`)      |
| `iconsCss`          | `string`                             | Font Awesome CSS to inline, for pages with inline icons that can't load the CDN                |
| `videoEmbeds`       | `'player'` or `'poster'`             | Hosted videos as live players (default) or as linked poster cards                              |
| `icons`             | `Map<string, PlainHtmlIcon>`         | Inline icons as SVG outlines, from `prepareMarkdownDocForPlainHtml` (see below)                |

URLs not in `links` or `images` pass through unchanged. Without a theme the page gets a plain
default stylesheet.

## Diagrams, charts, and data tables

A plain page runs no script, so anything the player draws at runtime has to be settled before the
page is written. `prepareMarkdownDocForPlainHtml(doc, options?)` does that, and returns the
document to render plus the pictures it drew:

```ts
import {
  markdownDocToPlainHtml,
  prepareMarkdownDocForPlainHtml,
} from '@bendyline/squisq-formats/html';
import { plainHtmlIcons } from '@bendyline/squisq-formats/html-icons';
import { createDiagramPictureRenderer } from '@bendyline/squisq-react/diagram-pictures';

const prepared = await prepareMarkdownDocForPlainHtml(doc, {
  renderDiagram: createDiagramPictureRenderer(),
  outlineIcons: plainHtmlIcons,
  container, // the ContentContainer holding the document's data files
});
const html = markdownDocToPlainHtml(prepared.markdownDoc, {
  title,
  images: prepared.images,
  icons: prepared.icons,
});
```

- **Mermaid, ASCII diagrams, timelines, and drawing, layout, and diagram blocks** become PNG
  pictures, embedded as `data:` URLs in `images` and sized to display at their natural width.
- **Charts** (`{[barChart]}`, `{[pieChart]}`, …) become a picture of the chart in place of their
  table; with `showTable=true` the table stays beneath it. A table the chart engine can't plot
  stays a table.
- **Data tables** that point at a data file (`{[dataTable src=…]}`, or a chart fed by one) get the
  file's first 100 rows (`maxDataRows`, or the block's own `previewRows`), then a "Showing N of M
  rows" note. The author's link to the full file follows.
- **Inline icons** (`{[fa-solid:star]}`) become small inline SVGs in the text color, outlined from
  the same Font Awesome fonts the Word, PDF, and EPUB exporters embed. The page needs no Font
  Awesome stylesheet, font, or network. This part needs no browser.
- **File trees** stay preformatted text, which reads as well as a picture and stays selectable.

Drawing needs a browser, so `renderDiagram` is the host's to supply: without it diagrams stay as
their source and charts as their table. A diagram the renderer can't draw also stays as source, and
`onWarning` hears about it.

`outlineIcons` is the host's to supply too, though it needs no browser: `plainHtmlIcons` reads the
Font Awesome fonts, about 2.5 MB with their parser, so it lives on its own subpath and a bundle that
only renders pages never carries it. Without it, icons keep their Font Awesome markup and the page
needs the Font Awesome stylesheet (`iconsCss`, or `externalResources: 'allow'`).

A host that prepares the same document over and over, such as a live preview, can wrap its renderer
in `cachingDiagramRasterizer` from `@bendyline/squisq-formats/diagrams`, so each pass redraws only
the diagrams that changed, and pass a `dataTableCache` map so data files are read once. Before
starting the asynchronous step,
`needsPlainHtmlPreparation(doc, { renderDiagram, outlineIcons, container })` tells it whether there
is anything to prepare, so a document with nothing to do renders at once.
The editor's Document and Print previews work this way.

## Place pages in your own template

For a real site you want your own header, navigation, footer, and stylesheet around each page.
Write the page as an ordinary HTML file that marks where content goes with standard `<slot>`
elements:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title><slot name="title">Untitled</slot> · Harbor Notes</title>
    <meta name="description" content="" />
    <link rel="stylesheet" href="site.css" />
  </head>
  <body>
    <header><a href="index.html">Harbor Notes</a></header>
    <main>
      <p class="date"><slot name="date"></slot></p>
      <slot></slot>
    </main>
  </body>
</html>
```

Then render the document's parts and fill the template:

```ts
import { applyHtmlPageTemplate, markdownDocToPlainHtmlParts } from '@bendyline/squisq-formats/html';

const parts = markdownDocToPlainHtmlParts(doc, { title });
const html = applyHtmlPageTemplate(
  template,
  {
    bodyHtml: parts.bodyHtml,
    headHtml: parts.featureHeadHtml,
    title,
    values: { description: 'Mooring depths from the spring survey.', date: '2026-04-12' },
  },
  { templatePath: '_template.html', outputPath: 'posts/spring-survey.html' },
);
```

`markdownDocToPlainHtmlParts` takes the same options as `markdownDocToPlainHtml` but returns the
pieces instead of a page: `bodyHtml`, `title`, and `featureHeadHtml` — the CSS the body's own
constructs need (feature sections, video embeds, SVG pictures, icons) without any theme styling,
so your stylesheet stays in charge.

`applyHtmlPageTemplate(template, content, options?)` fills the template:

- The one **unnamed `<slot>`** receives `bodyHtml`, wrapped in `<!-- squisq:content -->` and
  `<!-- /squisq:content -->` markers.
- A **named slot** receives `title` (for `name="title"`) or the matching entry in `values`,
  inserted as escaped text. A slot with no value is replaced by its children — its fallback
  content — so the template still previews sensibly when you open it in a browser.
- **`<title>`** can't contain elements, so slots written inside it are filled as text. A template
  without a `<title>` gets one.
- Existing **`<meta>` tags** are filled: `og:title` and `twitter:title` with the title;
  `description`, `og:description`, and `twitter:description` with `values.description`.
- **`headHtml`** goes into `<head>` before the template's first stylesheet, so your CSS cascades
  last.
- **Relative URLs** (`href`, `src`, `srcset`, `poster`, and similar) are rewritten from
  `templatePath`'s folder to `outputPath`'s, so `site.css` becomes `../site.css` on a page one
  folder down. Both options are paths relative to your site root; omit them to leave URLs alone.
- **Everything else** is copied byte for byte. The template is scanned, never re-serialized, so its
  formatting, comments, and scripts survive.

`bodyHtml` is inserted as-is. It comes out of the exporter already sanitized under `htmlPolicy`; if
you post-process it, keep it safe yourself.

### Check a template before you use it

```ts
import {
  HtmlPageTemplateError,
  inspectHtmlPageTemplate,
  isHtmlPageTemplate,
} from '@bendyline/squisq-formats/html';

isHtmlPageTemplate(html); // true when it has a <slot> outside any <template>

const { defaultSlotCount, namedSlots, errors } = inspectHtmlPageTemplate(html);
for (const { line, message } of errors) console.error(`_template.html:${line} ${message}`);
```

A usable template has exactly one unnamed slot, and its slots are balanced and not nested.
`applyHtmlPageTemplate` throws an `HtmlPageTemplateError` for anything else; its `issues` array
carries the same `{ message, line }` entries.

### Read a generated page back

`extractHtmlPageTemplateContent(html)` returns the body between the content markers, or `null`
when the page has none. The HTML importer uses it, so `htmlToMarkdownDoc` and `htmlToMarkdown` skip
the template's header and footer and recover just the document.

## Worked example: a small site

A two-page site with a shared template, a stylesheet, and an image:

```text
site-src/
├── _template.html
├── site.css
├── index.md
├── images/
│   └── harbor.svg
└── posts/
    └── spring-survey.md
```

`_template.html` is the template from the previous section. `posts/spring-survey.md`:

```markdown
---
title: Spring survey results
description: Mooring depths and conditions from the spring survey.
date: 2026-04-12
---

# Spring survey results

![The north breakwater at low tide](../images/harbor.svg)

The crew checked **14 moorings**. Two need new chain before summer.

| Mooring | Depth (m) | Condition |
| ------- | --------- | --------- |
| A1      | 6.2       | Good      |
| B4      | 4.8       | Worn      |

[Back to all notes](../index.md)
```

`index.md` has a `title` and `description` in its frontmatter and links to
`posts/spring-survey.md`. The build script renders each page into the template, rewrites `.md`
links to `.html`, and copies the assets:

```ts
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  inferDocumentTitle,
  parseMarkdown,
  type MarkdownDocument,
} from '@bendyline/squisq/markdown';
import {
  applyHtmlPageTemplate,
  collectLinkRefs,
  markdownDocToPlainHtmlParts,
} from '@bendyline/squisq-formats/html';

const SRC = 'site-src';
const OUT = 'site-out';
const PAGES = ['index.md', 'posts/spring-survey.md'];
const ASSETS = ['site.css', 'images/harbor.svg'];

/** Point every relative `.md` link at the page it becomes. */
function htmlLinks(doc: MarkdownDocument): Map<string, string> {
  const links = new Map<string, string>();
  for (const url of collectLinkRefs(doc)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) continue; // https:, mailto:, …
    const match = /^([^#?]+)\.md([#?].*)?$/.exec(url);
    if (match) links.set(url, `${match[1]}.html${match[2] ?? ''}`);
  }
  return links;
}

const template = await readFile(join(SRC, '_template.html'), 'utf8');

for (const page of PAGES) {
  const doc = parseMarkdown(await readFile(join(SRC, page), 'utf8'));
  const meta = doc.frontmatter ?? {};
  const text = (key: string) => (typeof meta[key] === 'string' ? meta[key] : undefined);
  const title = inferDocumentTitle(doc) ?? page; // frontmatter title, else the top heading

  const parts = markdownDocToPlainHtmlParts(doc, { title, links: htmlLinks(doc) });
  const outputPath = page.replace(/\.md$/, '.html');
  const html = applyHtmlPageTemplate(
    template,
    {
      bodyHtml: parts.bodyHtml,
      headHtml: parts.featureHeadHtml,
      title,
      values: { description: text('description'), date: text('date') },
    },
    { templatePath: '_template.html', outputPath },
  );

  await mkdir(dirname(join(OUT, outputPath)), { recursive: true });
  await writeFile(join(OUT, outputPath), html);
}

for (const asset of ASSETS) {
  await mkdir(dirname(join(OUT, asset)), { recursive: true });
  await copyFile(join(SRC, asset), join(OUT, asset));
}
```

`collectLinkRefs` returns every link URL in a document — Markdown links and `<a href>` in raw
HTML — exactly as written, which is the key `links` expects. Run the script with `npx tsx` and
`site-out/posts/spring-survey.html` comes out as:

```html
<title>Spring survey results · Harbor Notes</title>
<meta name="description" content="Mooring depths and conditions from the spring survey." />
<style data-squisq>
  /* … feature CSS … */
</style>
<link rel="stylesheet" href="../site.css" />
…
<header><a href="../index.html">Harbor Notes</a></header>
<main>
  <p class="date">2026-04-12</p>
  <!-- squisq:content -->
  <h1>Spring survey results</h1>
  <p><img src="../images/harbor.svg" alt="The north breakwater at low tide" /></p>
  …
  <p><a href="../index.html">Back to all notes</a></p>
  <!-- /squisq:content -->
</main>
```

The template's `site.css` and `index.html` links were rebased for the page one folder down, and the
document's own `../index.md` link became `../index.html`.

> [!TIP]
> Copied assets are served exactly as written. An `.svg` file you didn't author is better passed
> through the bundle exporters below, which write Squisq's sanitized version of each SVG instead.

### This site is built the same way

The documentation you're reading is a larger version of this script:
[`buildDocsSite.ts`](../../../packages/site/src/docsSite/buildDocsSite.ts) renders each page with
`markdownDocToPlainHtmlParts`, places it into one `page.html` template with
`applyHtmlPageTemplate`, and adds navigation, search, and live previews around it.

## Bundle a linked set of documents

When the pages link to each other, the bundle exporters do the crawling for you. Give one an entry
document and two read functions; it follows every relative `.md` link, renders each page, rewrites
the links to `.html`, collects the images, and returns everything as a ZIP `Blob`:

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { markdownDocsToPlainHtmlBundle } from '@bendyline/squisq-formats/html';

const root = 'site-src';
const zip = await markdownDocsToPlainHtmlBundle({
  entryPath: 'index.md',
  readDocument: (path) => readFile(join(root, path), 'utf8').catch(() => null),
  readBinary: (path) =>
    readFile(join(root, path))
      .then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
      .catch(() => null),
  themeId: 'warm-earth',
  entryAsIndex: true,
});
await writeFile('site.zip', new Uint8Array(await zip.arrayBuffer()));
// index.html, posts/spring-survey.html, images/harbor.svg
```

| Option                                | Effect                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `entryPath`                           | The first document, relative to your root                                                     |
| `readDocument`                        | Returns a document's Markdown text, or `null` when it doesn't exist                           |
| `readBinary`                          | Returns an image's bytes, or `null`                                                           |
| `title`                               | Title for the entry page; other pages use their frontmatter `title`, top heading, or filename |
| `theme` / `themeId` / `themeRegistry` | One theme for every page                                                                      |
| `entryAsIndex`                        | Write the entry as `index.html` (and point links to it there)                                 |
| `maxDepth`                            | How many links deep to follow (default unlimited; cycles are handled)                         |

The crawl stays inside the entry document's folder: links that climb above it aren't followed.
Images keep their relative paths, SVG images are written as Squisq's sanitized version, and linked
data files (`.csv`, `.tsv`, `.xlsx`, `.parquet`) are copied so their links still work. A document
that can't be read stops the export with an error; a missing image doesn't.

`markdownDocsToHtmlBundle` is the player-backed sibling. It takes the same options (except
`theme`; use `themeId`) plus `playerScript` (required), `mode` (`'static'`, the default, or
`'slideshow'`), and `showCodeCopyButton`. It writes one shared `squisq-player.js` beside the
pages.

The bundles use the plain page shell; they don't take a page template. For templated pages, use
your own loop as in the worked example.

## Player-backed pages

`docToHtml` turns a `Doc` into one self-contained HTML file with the player, the document, and its
images (as data URIs) inside:

```ts
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { docToHtml } from '@bendyline/squisq-formats/html';
import { PLAYER_BUNDLE } from '@bendyline/squisq-react/standalone-source';

const doc = markdownToDoc(parseMarkdown(markdown));
const html = docToHtml(doc, {
  playerScript: PLAYER_BUNDLE,
  title: 'Product launch review',
  mode: 'static',
  images: new Map([['images/team.png', teamPngBytes]]),
});
```

`mode` is `'slideshow'` (the default for `docToHtml`), `'static'` (the scrolling page), or
`'video'` (timed playback). `docToHtml` embeds the document as you pass it, so for a slideshow, run
`buildPreviewDoc` first and drop its empty preview-clock segment, as
[Standalone player](standalone-player.md#the-batteries-included-path-doctohtml) shows. `images` and `audio` map paths as the document writes them to
`ArrayBuffer`s. `docToHtmlZip` takes the same options and returns a ZIP `Blob` with `index.html`,
a separate `squisq-player.js`, and the media files — better for documents with large media.

The inlined player adds close to 2 MB to the file, and `PLAYER_BUNDLE` leaves out Mermaid; use
`PLAYER_BUNDLE_FULL` from `@bendyline/squisq-react/standalone-source/full` when documents have
Mermaid diagrams. The
[Standalone player](standalone-player.md) guide covers the player itself, and
[Converting formats](conversion.md) shows the same export through `convert()`, which reads the
images from a container for you.

## Outside-in documents

Outside-in editing keeps a rendered file — a page, a deck, a spreadsheet — as the file people see,
while its editable Markdown lives in a hidden companion folder beside it:

```text
reports/
├── Harbor Survey.html
└── Harbor Survey_files/
    ├── harbor-survey.md
    └── .original/original.html
```

The path rules are pure functions with no dependencies, published on their own at
`@bendyline/squisq-formats/outside-in-layout` for file explorers and other hosts that only need
paths:

```ts
import {
  chooseOutsideInMarkdownPath,
  isOutsideInTargetPath,
  resolveOutsideInLayout,
} from '@bendyline/squisq-formats/outside-in-layout';

const layout = resolveOutsideInLayout('reports/Harbor Survey.html');
// layout.markdownPath        'reports/Harbor Survey_files/harbor-survey.md'
// layout.companionDirectory  'reports/Harbor Survey_files'
// layout.relativeTargetPath  '../Harbor Survey.html'
```

`resolveOutsideInLayout` returns `null` for an unsupported file; outside-in covers `html`, `docx`,
`pdf`, `pptx`, `xlsx`, and `csv`. `isOutsideInTargetPath(path)` is the same test as a boolean, and
`chooseOutsideInMarkdownPath(layout, paths)` picks the companion's Markdown file from a directory
listing.

`@bendyline/squisq-formats/outside-in` re-exports those and adds the conversions:

| Function                                                                 | Does                                                                                                             |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `importOutsideInDocument({ data, targetPath })`                          | Imports the rendered file into `{ layout, markdown, container, warnings }`, with the relationship in frontmatter |
| `renderOutsideInDocument({ markdown, targetPath, container? }, options)` | Regenerates the rendered file from the Markdown; returns a `ConversionResult`                                    |
| `withOutsideInMarkdownEditing(markdown, layout, enabled?)`               | Opts the companion in to (or out of) regeneration                                                                |
| `isOutsideInMarkdownEditingEnabled(markdown)`                            | Whether regeneration is allowed                                                                                  |
| `readOutsideInMetadata(markdown)`                                        | The `{ version, format, target, updateFromMarkdown }` relationship, or `null`                                    |
| `readOutsideInOutputTemplate(markdown)`                                  | The page template the companion names in `squisq-output-template`, `'none'`, or `null`                           |

Regeneration is off until the companion's frontmatter sets `squisq-updatefrommarkdown: true`;
`renderOutsideInDocument` throws `invalid-input` until then. An HTML target references one shared
player instead of embedding it, so pass the player's URL relative to the rendered file:

```ts
import {
  renderOutsideInDocument,
  resolveOutsideInLayout,
  withOutsideInMarkdownEditing,
} from '@bendyline/squisq-formats/outside-in';

const layout = resolveOutsideInLayout('reports/Harbor Survey.html')!;
const markdown = withOutsideInMarkdownEditing(source, layout);
const page = await renderOutsideInDocument(
  { markdown, targetPath: layout.targetPath },
  { html: { playerScriptPath: '../_squisq/squisq-player.js' } },
);
```

Word, PDF, and PowerPoint targets can't draw Mermaid or Squisq diagrams. Pass `renderDiagram`
(`createDiagramPictureRenderer()` in the browser) and `renderOutsideInDocument` pictures them the
way [Diagrams in document formats](conversion.md#diagrams-in-document-formats) describes: Word and
PDF get a picture of each diagram and chart, and PowerPoint, which draws the rest as native shapes,
gets pictures of Mermaid diagrams. With a `container`, each `{[dataTable src=…]}` reference shows
its first rows, as every `convert()` export does.

Your host owns the file system: it writes the result, copies the import's media into the companion
folder, and resolves and applies a `squisq-output-template` page template when it wants one. A page
generated through a template is a plain page, so prepare it as in
[Diagrams, charts, and data tables](#diagrams-charts-and-data-tables), and pass the companion's
files in `links` as well as `images` so links to attachments resolve from the page, and the
prepared `icons` in `icons`. Authors choose
that template as described in [Page templates](../../guide/page-templates.md).

## Related

- [Page templates](../../guide/page-templates.md) — page templates from the author's side
- [Converting formats](conversion.md) — every other format, through one function
- [Standalone player](standalone-player.md) — the player inside player-backed pages
- [Static blog sample](../samples/static-blog.md)
- API reference: [HTML](../../API.md#subpath-html)
