---
title: No-build player
description: Present a Squisq document from a plain HTML page that loads the standalone player from a CDN, or from one self-contained HTML file.
---

# No-build player

A five-slide board update, presented from an ordinary HTML page with no bundler and no framework. The page loads the standalone player from jsDelivr and mounts the talk into a `<div>`, with buttons to switch between the slideshow, the scrolling page, and the dashboard. A second script writes the same talk as one HTML file you can email or open straight from disk.

What it demonstrates:

- The standalone player bundle, `squisq-player.global.js` from `@bendyline/squisq-react`, served by a CDN at an exact version.
- Its `SquisqPlayer.mount()` API and the `slideshow`, `static`, and `dashboard` modes.
- Preparing the document ahead of time in Node, because the bundle renders documents but does not read Markdown.
- `docToHtml` from `@bendyline/squisq-formats/html`, for a single self-contained file.

## Where the document comes from

The bundle defines one global, `SquisqPlayer`, with `mount`, `getHandle`, `unmount`, and `version`. `mount(element, doc, options)` takes a `Doc`, the JSON document model, and there is no Markdown parser in the bundle. So a small Node script converts the Markdown once, the way the Squisq editor's preview does, and saves the result as JSON next to the page. Run it again whenever the Markdown changes.

## Files

```text
harbor-talk/
├── package.json        # for the two Node scripts only
├── talk.md
├── images/
│   └── harbor.svg
├── prepare-doc.mjs     # talk.md → talk.json
├── index.html          # the page: CDN player + talk.json
└── bundle.mjs          # talk.md → talk.html, one self-contained file
```

The page itself needs nothing from npm. The `package.json` is for the scripts that prepare it.

**`package.json`**

```json
{
  "name": "harbor-talk",
  "private": true,
  "type": "module",
  "scripts": {
    "prepare-doc": "node prepare-doc.mjs talk.md",
    "bundle": "node bundle.mjs talk.md"
  },
  "dependencies": {
    "@bendyline/squisq": "2.13.6",
    "@bendyline/squisq-formats": "2.8.7",
    "@bendyline/squisq-react": "2.12.18",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  }
}
```

**`talk.md`**

```markdown
---
title: The Harbor in Numbers
---

# The Harbor in Numbers

A five-minute update for the October board meeting.

## Moorings in use {[statHighlight]}

**212** of 240 moorings are rented for the winter, the highest count in a decade.

## The north basin {[leftFeature]}

![Boats at anchor in the north basin at dusk](images/harbor.svg)

The north basin at dusk, after the autumn survey.

## What we heard {[quote]}

> Fix the east breakwater before you add a single new slip.
> — Survey respondent, slip 41

## Next steps

- Collect two dredging quotes by November 15
- Replace the chain on buoys 14 through 19
- Re-survey the east face in April
```

Any image works. This one is a small illustration you can paste as-is.

**`images/harbor.svg`**

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800">
  <title>Harbor illustration</title>
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0f4c5c"/>
      <stop offset="1" stop-color="#f2a65a"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="800" fill="url(#sky)"/>
  <circle cx="930" cy="250" r="110" fill="#ffe3b3" opacity="0.9"/>
  <path d="M0 520 Q300 470 600 515 T1200 505 V800 H0Z" fill="#0b3c49"/>
  <path d="M0 590 Q300 560 600 600 T1200 585 V800 H0Z" fill="#08303b"/>
  <path d="M250 520 l60 -170 l8 170z" fill="#f6efe2"/><path d="M318 520 l0 -150 l70 150z" fill="#e9dcc4"/>
  <path d="M215 520 h200 l-25 30 h-150z" fill="#3a2a1d"/>
  <path d="M780 548 h120 l-15 20 h-90z" fill="#3a2a1d"/><path d="M830 548 l0 -90 l40 90z" fill="#f6efe2"/>
</svg>
```

**`prepare-doc.mjs`**

```js
// Convert a Markdown talk to the Doc JSON the standalone player mounts.
//
//   node prepare-doc.mjs talk.md   →   talk.json
import { readFile, writeFile } from 'node:fs/promises';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { buildPreviewDoc, markdownToDoc } from '@bendyline/squisq/doc';

const input = process.argv[2] ?? 'talk.md';
const output = input.replace(/\.md$/i, '') + '.json';

// The document as written: Page and Dashboard modes render this.
const doc = markdownToDoc(parseMarkdown(await readFile(input, 'utf8')));

// The slide projection the editor's preview plays: Slideshow mode renders this.
const slides = buildPreviewDoc(doc);
// buildPreviewDoc adds an audio segment with no file behind it as the editor
// preview's clock. Drop it so the player runs on its own timer instead of
// looking for audio.
slides.audio = { ...slides.audio, segments: slides.audio.segments.filter((s) => s.src) };

await writeFile(output, JSON.stringify({ doc, slides }));
console.log(`Wrote ${output} (${slides.blocks.length} slides)`);
```

**`index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>The Harbor in Numbers</title>
    <!-- Icon fonts for inline icons. The player injects its own animation CSS. -->
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/@bendyline/squisq-react@2.12.18/dist/styles/index.css"
    />
    <script src="https://cdn.jsdelivr.net/npm/@bendyline/squisq-react@2.12.18/dist/squisq-player.global.js"></script>
    <style>
      body {
        margin: 0;
        padding: 24px 16px;
        background: #10202a;
        color: #e8eef2;
        font-family: system-ui, sans-serif;
      }
      main {
        max-width: 960px;
        margin: 0 auto;
      }
      nav {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
      }
      nav button {
        padding: 6px 14px;
        border: 1px solid #3c5a6b;
        border-radius: 6px;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      nav button[aria-pressed='true'] {
        background: #e8eef2;
        color: #10202a;
      }
      #stage {
        width: 100%;
        overflow: hidden;
        border-radius: 8px;
      }
      #stage[data-mode='static'] {
        height: 75vh;
        background: #fff;
      }
      #stage[data-mode='dashboard'] {
        aspect-ratio: 16 / 9;
      }
      #stage[data-mode='static'] > * {
        height: 100%;
      }
    </style>
  </head>
  <body>
    <main>
      <nav>
        <button type="button" data-mode="slideshow">Slideshow</button>
        <button type="button" data-mode="static">Page</button>
        <button type="button" data-mode="dashboard">Dashboard</button>
      </nav>
      <div id="stage"></div>
    </main>
    <script>
      const stage = document.getElementById('stage');
      const buttons = document.querySelectorAll('nav button');
      let talk = null;

      function show(mode) {
        stage.dataset.mode = mode;
        // Mounting into the same element replaces the previous player.
        SquisqPlayer.mount(stage, mode === 'slideshow' ? talk.slides : talk.doc, { mode });
        buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
      }

      buttons.forEach((b) => b.addEventListener('click', () => show(b.dataset.mode)));

      fetch('talk.json')
        .then((response) => response.json())
        .then((json) => {
          talk = json;
          show('slideshow');
        })
        .catch((err) => {
          stage.textContent = `Could not load talk.json: ${err.message}`;
        });
    </script>
  </body>
</html>
```

**`bundle.mjs`**

```js
// Write the talk as one self-contained HTML file: player, slides, and images inline.
//
//   node bundle.mjs talk.md   →   talk.html
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseMarkdown, inferDocumentTitle } from '@bendyline/squisq/markdown';
import { buildPreviewDoc, markdownToDoc } from '@bendyline/squisq/doc';
import { collectImagePaths, docToHtml } from '@bendyline/squisq-formats/html';
import { PLAYER_BUNDLE } from '@bendyline/squisq-react/standalone-source';

const input = process.argv[2] ?? 'talk.md';
const output = input.replace(/\.md$/i, '') + '.html';

const markdown = parseMarkdown(await readFile(input, 'utf8'));
const slides = buildPreviewDoc(markdownToDoc(markdown));
slides.audio = { ...slides.audio, segments: slides.audio.segments.filter((s) => s.src) };

// Every relative image the slides use, read from disk and inlined as data URIs.
const images = new Map();
for (const path of collectImagePaths(slides)) {
  const bytes = await readFile(join(dirname(input), path));
  images.set(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

const html = docToHtml(slides, {
  playerScript: PLAYER_BUNDLE,
  images,
  mode: 'slideshow',
  title: inferDocumentTitle(markdown),
});
await writeFile(output, html);
console.log(`Wrote ${output} (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
```

## Run it

Install the script dependencies and convert the talk:

```bash
npm install
node prepare-doc.mjs talk.md
```

```text
Wrote talk.json (5 slides)
```

Then serve the folder over HTTP and open the page. Any static server works; Python's is usually already installed:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080/`. The slideshow starts on a cover slide made from the title and first paragraph; the arrow keys and the buttons in the corner step through it.

> [!NOTE]
> Opening `index.html` straight from disk doesn't work: browsers block `fetch()` from a `file:` page, so `talk.json` never loads. The [single-file version](#one-self-contained-file) below needs no server.

## How it works

### Two documents in one file

`prepare-doc.mjs` writes both shapes of the talk to `talk.json`:

- `doc`, from `markdownToDoc`: the document as written, with blocks nested the way the headings nest. The `static` (page) and `dashboard` modes render this one.
- `slides`, from `buildPreviewDoc(doc)`: the flat list of player-ready slides the editor's preview plays. The `slideshow` mode renders this one. Without the projection, a heading with no `{[template]}` tag would show as a bare section header without its text.

### The empty audio segment

`buildPreviewDoc` gives the slides a timeline backed by an audio segment with no file behind it. When a mounted document has any audio segment, the player plays it as media, and an empty one fails with "Audio could not be loaded." Removing segments without a `src` makes the player run on its own timer. Keep that line whenever you prepare slides for the standalone player.

### Mounting

`SquisqPlayer.mount(stage, doc, { mode })` renders into `stage` and returns a handle. Mounting into the same element again replaces the player, which is all the mode buttons do. The modes:

| `mode`       | Renders                                                         |
| ------------ | --------------------------------------------------------------- |
| `slideshow`  | One slide at a time with previous and next controls (default)   |
| `video`      | The timeline played with a scrubber; add `loop: true` to repeat |
| `static`     | The scrolling page, art-directed by the theme                   |
| `dashboard`  | Every block arranged on one canvas                              |
| `flashcards` | A study deck built from the heading hierarchy                   |

A few other options are worth knowing: `theme` takes a `Theme` object, `autoPlay` starts playback, `images` maps image paths to URLs (data URIs included), and `globalKeyboardShortcuts` (on by default) lets the arrow keys drive the player without focus. Turn it off when a page mounts more than one player.

The stage needs a size for two of the modes: the page scrolls inside the stage's height, and the dashboard fills the stage's box. The CSS sets a height for `static` and a 16:9 aspect ratio for `dashboard`; the slideshow sizes itself from the width.

### Images

Relative image paths resolve against the page, so `images/harbor.svg` in the Markdown loads from the `images` folder beside `index.html`. SVG files are sanitized before they are shown.

### The CDN tags

The `<script>` tag loads the player, about 1.6 MB minified. Pin an exact version in the URL, as the page does, so an update can't change your page under you. The stylesheet supplies the icon fonts for inline icons such as `{[fa-solid:anchor]}`; the player injects its own animation styles.

The default bundle leaves out the Mermaid diagram renderer to stay small. If your talks use Mermaid diagrams, load `dist/squisq-player.full.global.js` instead, about 5 MB.

## One self-contained file

`bundle.mjs` writes `talk.html`: the player, the slides, and the images as data URIs, all in one file of about 1.9 MB (mostly the player). It needs no server and no network, so you can open it from disk, email it, or attach it to a calendar invite.

```bash
node bundle.mjs talk.md
```

```text
Wrote talk.html (1.9 MB)
```

`docToHtml` serializes the document you give it and does not project it, so the script runs the same preparation as `prepare-doc.mjs`: `buildPreviewDoc`, then removing the empty audio segment. `collectImagePaths(slides)` lists the relative images the slides use, and the script reads each from disk into the `images` map. Pass `mode: 'static'` instead of `'slideshow'` (and the unprojected `doc`) for a scrolling page, or `mode: 'video'` for timed playback.

The [Node converter](node-converter.md) shows the registry's `html` format, which builds the same kind of file from Markdown in one call and defaults to the page rendition.

## Ideas for extending it

- **A kiosk loop.** Mount with `{ mode: 'video', autoPlay: true, loop: true }` to play the talk on a lobby screen.
- **A theme.** Add `squisq-theme: documentary` (or any [built-in theme](../../guide/themes.md)) to the talk's frontmatter, or pass `theme` in the mount options.
- **Several talks on one page.** Prepare one JSON file per talk, mount each into its own element, and pass `globalKeyboardShortcuts: false`.
- **A ZIP instead of one file.** `docToHtmlZip` takes the same options and writes `index.html`, `squisq-player.js`, and the images as separate files.
- **Prepare in the browser.** If your page has a bundler after all, the [React viewer](react-viewer.md) converts Markdown live.
