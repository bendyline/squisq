---
title: The standalone player
description: Put Squisq slideshows, pages, and dashboards on any web page with one script tag and a document converted ahead of time, no React or build step on the page.
---

# The standalone player

The standalone player is the Squisq player compiled into one browser script. It brings its own
copy of the rendering code (on Preact) and defines a global, `SquisqPlayer`, so any page — a CMS
template, a static site, a Markdown export — can show a document with a script tag and a few lines
of JavaScript. This documentation site's live examples run on it.

## Quick start

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Harbor survey</title>
    <link rel="stylesheet" href="squisq/styles/index.css" />
  </head>
  <body>
    <div id="deck" style="max-width: 960px; margin: auto"></div>
    <script src="squisq/squisq-player.global.js"></script>
    <script>
      fetch('harbor-survey.json')
        .then((response) => response.json())
        .then((doc) => {
          SquisqPlayer.mount(document.getElementById('deck'), doc, {
            mode: 'slideshow',
            viewport: { width: 1920, height: 1080 },
          });
        });
    </script>
  </body>
</html>
```

Three things go on the page: the player script and the package stylesheet (here copied from the
package's `dist/` folder into `squisq/`), and a `Doc` as JSON. The player can't read Markdown — the global has only `mount`, `getHandle`, `unmount`, and `version` —
so you convert your Markdown ahead of time, as shown [below](#produce-the-document-json).

## Get the player

| You want                                  | Use                                                                                                                                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A file to serve beside your pages         | `@bendyline/squisq-react/standalone` — `node_modules/@bendyline/squisq-react/dist/squisq-player.global.js`                                                                        |
| The same, from a CDN                      | `https://cdn.jsdelivr.net/npm/@bendyline/squisq-react@2.12.18/dist/squisq-player.global.js` (pin the version you tested)                                                          |
| The player as a string, in a build script | `PLAYER_BUNDLE` from `@bendyline/squisq-react/standalone-source`                                                                                                                  |
| Mermaid diagrams too                      | The full variants: `@bendyline/squisq-react/standalone/full` (`dist/squisq-player.full.global.js`) and `PLAYER_BUNDLE_FULL` from `@bendyline/squisq-react/standalone-source/full` |

The default player leaves out Mermaid, whose parser and layout engines add several megabytes (the
full script is about 5 MB against 1.6 MB). A ` ```mermaid ` fence in the light player shows a
message instead of the diagram. Every other diagram — box art, trees, timelines, SVG pictures —
works in both.

**Styles.** With the script file, also load the package stylesheet,
`dist/styles/index.css` (with its three `.woff2` font files beside it), for the Font Awesome icons
documents use. The player injects its own animation styles either way. `PLAYER_BUNDLE` and
`PLAYER_BUNDLE_FULL` carry the icon styles inside them, so a page built from those needs no
stylesheet.

To serve `PLAYER_BUNDLE` as a file, write it out in your build:

```ts
// scripts/copy-player.ts
import { writeFileSync } from 'node:fs';
import { PLAYER_BUNDLE } from '@bendyline/squisq-react/standalone-source';
import { PLAYER_BUNDLE_FULL } from '@bendyline/squisq-react/standalone-source/full';

const needsMermaid = process.argv.includes('--mermaid');
writeFileSync('public/squisq-player.js', needsMermaid ? PLAYER_BUNDLE_FULL : PLAYER_BUNDLE);
```

## Produce the document JSON

Convert Markdown with `@bendyline/squisq` in Node (or in any build step), and save the result:

```ts
// build-docs.ts — run with `npx tsx build-docs.ts <output folder>`
import { writeFileSync } from 'node:fs';
import { buildPreviewDoc, markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { Doc } from '@bendyline/squisq/schemas';

const out = process.argv[2] ?? '.';
const source = `# Harbor survey, spring

![The north basin](images/harbor.svg)

## Moorings {[statHighlight]}

**42** moorings inspected, six chains replaced

## Next steps

- Dredge the channel before June
- Replace the two damaged buoys
`;

const parsed = markdownToDoc(parseMarkdown(source));

// buildPreviewDoc gives a document without narration a preview clock: one audio
// segment with no file. Drop it, or the player tries to load it.
function withoutPreviewClock(doc: Doc): Doc {
  return { ...doc, audio: { ...doc.audio, segments: doc.audio.segments.filter((s) => s.src) } };
}

// Slideshow and video mounts: the editor's slide projection.
writeFileSync(`${out}/deck.json`, JSON.stringify(withoutPreviewClock(buildPreviewDoc(parsed))));
// Static, dashboard, and flashcards mounts: the parsed document as it is.
writeFileSync(`${out}/report.json`, JSON.stringify(parsed));
```

Two documents, because the renditions want different shapes:

- **Slideshow and video** take the output of `buildPreviewDoc`, the flat slide list the editor's
  preview shows. Without it, headings with no template tag render as bare section headers and
  their paragraphs disappear.
- **Static, dashboard, and flashcards** take the nested document from `markdownToDoc`. The
  dashboard runs its own projection, and flashcards need the heading hierarchy.

[Rendering documents in React](rendering.md#build-the-doc-yourself) explains the projection and its
options.

## Mount options

`SquisqPlayer.mount(element, doc, options)` renders into `element` and returns a handle. Every
option is optional.

| Option                                                    | Default        | What it does                                                                                                                                                                                                 |
| --------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mode`                                                    | `'slideshow'`  | `'slideshow'`, `'video'` (timed playback with a scrub bar), `'static'` (the scrolling page), `'dashboard'`, or `'flashcards'`.                                                                               |
| `viewport`                                                | —              | `{ width, height }` in CSS pixels to compose slides for. Without it, a live player follows the browser window's shape.                                                                                       |
| `basePath`                                                | `'.'`          | Prefix for relative media paths that aren't in `images`.                                                                                                                                                     |
| `images`                                                  | —              | Map of media paths, as the document writes them, to URLs (`data:`, `blob:`, or ordinary URLs).                                                                                                               |
| `audio`                                                   | —              | Map of narration segment names or `src` values to URLs; rewrites `doc.audio`.                                                                                                                                |
| `theme`                                                   | doc's theme    | A `Theme` object that replaces the document's own.                                                                                                                                                           |
| `motion`                                                  | doc's setting  | Motion profile: `'calm'`, `'documentary'`, `'vibrant'`, or a spec.                                                                                                                                           |
| `animationsEnabled`                                       | `true`         | `false` removes layer animations and slide transitions; media and timing still run.                                                                                                                          |
| `buildsEnabled`                                           | `true`         | `false` shows every build step at once.                                                                                                                                                                      |
| `autoPlay`                                                | `false`        | Start playing on mount (ignored in render mode).                                                                                                                                                             |
| `loop`                                                    | `false`        | Restart when the timeline ends. Video mode only.                                                                                                                                                             |
| `captionStyle`                                            | captions off   | `'standard'` or `'social'` turns captions on. Leave it out for none.                                                                                                                                         |
| `captionPosition`                                         | per style      | `'top'`, `'center'`, or `'bottom'`.                                                                                                                                                                          |
| `globalKeyboardShortcuts`                                 | `true`         | The arrow keys work without focusing the player. Turn it off with more than one player on a page.                                                                                                            |
| `dashboard`                                               | —              | Dashboard mode: `{ layout, title, style, documentTitle }` — a layout id or `'auto'`, the title band on or off, `'basic' \| 'card' \| 'panel' \| 'accent'`, and a fallback title. Each overrides frontmatter. |
| `videoPresentation`, `pipSize`, `pipShape`, `pipPosition` | doc's settings | Where scheduled video sits relative to the slides.                                                                                                                                                           |
| `showCodeCopyButton`                                      | `false`        | A Copy button on code blocks (static mode).                                                                                                                                                                  |
| `onCopyCode`                                              | —              | Your own clipboard handler for that button.                                                                                                                                                                  |
| `renderMode`                                              | `false`        | Headless capture: no controls, a deterministic clock, and a render API on the handle.                                                                                                                        |

Static mode renders the page rendition, which uses `theme`, `basePath`, `images`,
`animationsEnabled`, `globalKeyboardShortcuts`, and the two copy options; the playback options
don't apply to it. A dashboard sizes its canvas from the element's box, so give the element a
height (or an `aspect-ratio`).

`mount` picks the clock for you: a document with narration segments plays its audio, and one
without runs on a timer. That's why the preview clock above has to go — an empty segment still
counts as narration, and the player shows "Audio could not be loaded".

## Images, audio, and other media

Every media path the document references — images, video files, timed audio and video clips — is
looked up in `images` first. A key matches the path exactly, without a leading `./`, or by file
name alone, so `images/harbor.svg` finds a key `harbor.svg`. Paths that aren't in the map load
from `basePath`, and `http(s)`, `data:`, and `blob:` paths load as they are.

```js
SquisqPlayer.mount(root, doc, {
  images: {
    'images/harbor.svg': '/media/harbor-survey/harbor.svg',
    'team.jpg': 'data:image/jpeg;base64,/9j/4AAQ…',
  },
  audio: {
    intro: '/media/harbor-survey/intro.mp3',
  },
});
```

`audio` is only for the narration segments in `doc.audio` (keyed by a segment's `name` or `src`).
Those are fetched in full before they play, so they must be reachable with `fetch`. SVG images are
fetched too, then sanitized and shown as a `data:` URL.

## The handle

```js
const handle = SquisqPlayer.mount(root, doc, { mode: 'video', renderMode: true });
const api = await handle.renderAPI; // null unless renderMode is on
await api.seekTo(4.5); // resolves once that moment is painted and ready to capture
```

| Member                            | What it is                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `handle.element`                  | The element the player is mounted in.                                                                                |
| `handle.renderAPI`                | A promise of the render API. It resolves to `null` unless `renderMode` is on in slideshow, video, or dashboard mode. |
| `handle.getRenderAPI()`           | The render API now, or `null` if it isn't ready yet.                                                                 |
| `handle.unmount()`                | Remove this player. Does nothing if another `mount` has replaced it.                                                 |
| `SquisqPlayer.getHandle(element)` | The handle for the player in `element`, if any.                                                                      |
| `SquisqPlayer.unmount(element)`   | Remove whatever player is in `element`.                                                                              |
| `SquisqPlayer.version`            | The package version the script was built from.                                                                       |

The render API is the same one `DocPlayer` provides — `seekTo`, `getDuration`, `getBlocks`,
`getCaptions`, and the rest; see
[Capture frames with the render API](rendering.md#capture-frames-with-the-render-api). A dashboard
mount provides it too, with a duration of 0 and a `seekTo` that waits for images and fonts. Nothing
is copied onto `window`: keep the handle, or ask `getHandle` for it.

To change the document, theme, or mode, call `mount` again on the same element. It re-renders in
place and the old handle stops working.

### TypeScript

`MountOptions` and `SquisqPlayerHandle` are exported from `@bendyline/squisq-react`. Declare the
global once and the rest is typed:

```ts
// squisq-player.d.ts
import type { Doc } from '@bendyline/squisq/schemas';
import type { MountOptions, SquisqPlayerHandle } from '@bendyline/squisq-react';

declare global {
  const SquisqPlayer: {
    mount(element: Element, doc: Doc, options?: MountOptions): SquisqPlayerHandle;
    getHandle(element: Element): SquisqPlayerHandle | undefined;
    unmount(element: Element): void;
    readonly version: string;
  };
}
```

## Several players on one page

Each `mount` is independent, so a page can hold a deck, a report, and a dashboard side by side.
Set `globalKeyboardShortcuts: false` on every interactive player, or one keypress moves them all;
each still responds to the keyboard once it has focus. Pass `viewport` to each slideshow so it
keeps its shape whatever the window does.

```js
const players = [
  ['deck', 'deck.json', { mode: 'slideshow', viewport: { width: 1920, height: 1080 } }],
  ['report', 'report.json', { mode: 'static' }],
];
for (const [id, url, options] of players) {
  fetch(url)
    .then((response) => response.json())
    .then((doc) =>
      SquisqPlayer.mount(document.getElementById(id), doc, {
        ...options,
        globalKeyboardShortcuts: false,
      }),
    );
}
```

## Content Security Policy

The light player runs without `eval`, but it does inject styles. A page that serves the script as a file
works under this policy:

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
media-src 'self' data: blob:;
connect-src 'self'
```

| Directive                   | Why                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `style-src 'unsafe-inline'` | The player adds a `<style>` element for its animations (and, from `PLAYER_BUNDLE`, its icon styles). |
| `img-src data: blob:`       | Inlined images and sanitized SVGs are `data:` URLs.                                                  |
| `font-src data:`            | `PLAYER_BUNDLE`'s icon fonts are `data:` URLs. Not needed with the stylesheet and font files.        |
| `media-src blob:`           | Narration plays from `blob:` URLs after it's fetched.                                                |
| `connect-src`               | Narration and local SVG images are fetched. Add the hosts your media comes from.                     |

An inline `<script>` that holds the player, as `docToHtml` writes, needs `script-src 'unsafe-inline'`
or a hash of that script. Documents with hosted videos also need `frame-src` for the video
provider and `img-src` for its thumbnails.

## The batteries-included path: `docToHtml`

If you want a finished page rather than an embed, `@bendyline/squisq-formats/html` writes one:

```ts
import { writeFileSync } from 'node:fs';
import { buildPreviewDoc, markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { docToHtml } from '@bendyline/squisq-formats/html';
import { PLAYER_BUNDLE } from '@bendyline/squisq-react/standalone-source';

const source = '# Harbor survey\n\n## Moorings {[statHighlight]}\n\n**42** inspected\n';
const deck = buildPreviewDoc(markdownToDoc(parseMarkdown(source)));
const html = docToHtml(
  { ...deck, audio: { ...deck.audio, segments: deck.audio.segments.filter((s) => s.src) } },
  { playerScript: PLAYER_BUNDLE, mode: 'slideshow', title: 'Harbor survey', themeId: 'documentary' },
);
writeFileSync('harbor-survey.html', html);
```

`docToHtml` returns one self-contained HTML file: the player, the document, and every image in
`images` (a `Map` of path to bytes) inlined. `docToHtmlZip` returns a ZIP with `index.html`,
`squisq-player.js`, and the images and audio as separate files. Both take `mode` (`'slideshow'`,
`'video'`, or `'static'`; `'slideshow'` by default), `title`, `themeId`, `autoPlay`, `captionStyle`,
`captionPosition`, and `showCodeCopyButton`, and both embed the document as you pass it — run
`buildPreviewDoc` yourself for a slideshow. The format registry's `convert()` uses them for its
`html` and `htmlzip` targets; see [Converting formats](conversion.md). For plain HTML with no
player at all, see [Publishing static sites](static-sites.md).

## Pitfalls

- **"Audio could not be loaded" on a deck with no audio.** The document still has
  `buildPreviewDoc`'s preview clock. Filter out segments with no `src`.
- **A landscape deck shows up portrait.** Without `viewport`, a live player follows the window's
  shape. Pass `viewport`.
- **One keypress moves every player.** `globalKeyboardShortcuts` defaults to `true` here (unlike
  the React component). Turn it off.
- **Icons are missing.** You loaded the raw script without the package stylesheet.
- **Mermaid fences show a message.** Use the full player.
- **Slides drop their text.** You mounted `markdownToDoc` output in slideshow mode; run
  `buildPreviewDoc` first.

## Related

- [API reference: styles and standalone bundle](../../API.md#styles--standalone-bundle)
- [Rendering documents in React](rendering.md) — the same player as a React component
- [Producing video and images](video-and-images.md) — headless capture built on render mode
- [How this site uses it](../../../packages/site/src/docsSite/buildDocsSite.ts): the build converts
  each example and the browser mounts it with `globalKeyboardShortcuts: false`
