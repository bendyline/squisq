---
title: Rendering documents in React
description: Show Squisq documents in a React app as slideshows, videos, scrolling pages, dashboards, or plain Markdown, with your own media, themes, and controls.
---

# Rendering documents in React

`@bendyline/squisq-react` turns a Squisq document into something people can watch, click
through, or scroll. This guide shows the components you'll reach for, in the order you're likely
to need them: `DocPlayer` for slides and video, `LinearDocView` for the scrolling page,
`DashboardView` for one-screen summaries, and `MarkdownRenderer` and `BlockRenderer` for smaller
pieces.

```bash
npm install @bendyline/squisq @bendyline/squisq-react
```

`react` and `react-dom` 18 or 19 are peer dependencies.

## Show a slideshow

Import the stylesheet once, then give `DocPlayer` some Markdown:

```tsx
import { DocPlayer } from '@bendyline/squisq-react';
import '@bendyline/squisq-react/styles';

const source = `# Spring product launch

## The problem

Field teams lose an hour a day re-keying survey notes.

## Our answer {[statHighlight]}

**60 minutes** saved per technician, every day
`;

export function LaunchDeck() {
  return (
    <div style={{ maxWidth: 960 }}>
      <DocPlayer markdown={source} displayMode="slideshow" audioMode="synthetic" />
    </div>
  );
}
```

That renders this deck (the player also adds a cover slide, which this preview leaves out):

```markdown preview
# Spring product launch

## The problem

Field teams lose an hour a day re-keying survey notes.

## Our answer {[statHighlight]}

**60 minutes** saved per technician, every day
```

The player fills the width of its container and keeps the slide's aspect ratio, so size it with
the wrapper. Click it to give it focus, then use the arrow keys or space bar, the on-screen
controls, or a swipe to move through the slides.

## Build the Doc yourself

The `markdown` prop is a shortcut: it runs `markdownToDoc(parseMarkdown(markdown))` and nothing
more. The editor's slideshow does one more step, `buildPreviewDoc`, which turns the parsed document
into the flat list of slides the editor shows. Without it, a heading with no template tag renders
as a bare section header and its paragraphs are dropped. Run the projection yourself when you want
your app to match what authors see in the editor:

```tsx
import { useMemo } from 'react';
import { buildPreviewDoc, markdownToDoc, VIEWPORT_PRESETS } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { DocPlayer } from '@bendyline/squisq-react';

export function Deck({ source }: { source: string }) {
  const slides = useMemo(() => buildPreviewDoc(markdownToDoc(parseMarkdown(source))), [source]);
  return (
    <DocPlayer
      doc={slides}
      displayMode="slideshow"
      audioMode={slides.audio.segments.some((s) => s.src) ? 'media' : 'synthetic'}
      forceViewport={VIEWPORT_PRESETS.landscape}
      basePath="/decks/spring-launch"
      globalKeyboardShortcuts
    />
  );
}
```

Which document to pass depends on the rendition:

| Rendition                              | Pass                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Slideshow and video                    | `buildPreviewDoc(markdownToDoc(parseMarkdown(source)))`                                               |
| Page, dashboard, and flashcards        | `markdownToDoc(parseMarkdown(source))` — these keep the nested blocks; the dashboard projects its own |
| A `Doc` you stored as JSON or imported | The stored `Doc`, through `buildPreviewDoc` first if it came straight from `markdownToDoc`            |

`buildPreviewDoc` takes two options: `documentTitle` (a heading for the untitled introduction when
the document has no frontmatter `title`; `documentTitleFromFileName('Q3 Plan.md')` gives you one
from a file name) and `interleaveImages` (default `true`, which gives unused images their own
slides — pass `false` when a narration recording sets the timing). The
[projections concept page](../concepts/projections.md) explains the three projections in depth.

When the document has no narration, `buildPreviewDoc` gives it a preview clock: one audio segment
with an empty `src` and a duration. It's a timer, not a file, so choose the audio mode from whether
any segment has a `src`, as the example does. In the default `'media'` mode the player would try
to load that empty segment and show "Audio could not be loaded".

## Choose a display mode

`displayMode` picks the rendition. These are the values `DocPlayer` renders:

| `displayMode`     | What you get                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `video` (default) | Timed playback with a play button and scrub bar; blocks advance on the clock                    |
| `slideshow`       | One slide at a time with previous and next controls; nothing advances on its own                |
| `linear`          | The scrolling page rendition (Page mode in the editor), rendered by `LinearDocView`             |
| `dashboard`       | Every block arranged on one canvas, rendered by `DashboardView`                                 |
| `flashcards`      | A study deck that reveals cards and multiple-choice quizzes from the document's nested headings |

The `DisplayMode` type also lists `page` and `narrate`, but `DocPlayer` doesn't render them: the
editor owns both. `page` is the editor's Document view, the same output as the plain HTML exporter
(see [Publishing static sites](static-sites.md)), and `narrate` is the teleprompter. Readers'
descriptions of each mode are on the [display modes page](../../guide/display-modes.md).

Dashboard mode reads four extra props, each of which overrides the matching frontmatter setting:

| Prop                     | Value                                          |
| ------------------------ | ---------------------------------------------- |
| `dashboardLayout`        | A layout id, or `'auto'`                       |
| `dashboardShowTitle`     | Show or hide the title band                    |
| `dashboardStyle`         | `'basic'`, `'card'`, `'panel'`, or `'accent'`  |
| `dashboardDocumentTitle` | A title to fall back on, usually the file name |

See [Dashboards](../../guide/dashboards.md) for the layouts and styles themselves.

## Key `DocPlayer` props

### Content and media

| Prop              | Default   | What it does                                                                                   |
| ----------------- | --------- | ---------------------------------------------------------------------------------------------- |
| `doc`             | —         | The `Doc` to render. Wins over `markdown`.                                                     |
| `markdown`        | —         | Markdown to convert when `doc` is absent. With neither, the player renders an empty container. |
| `basePath`        | `'.'`     | Prefix for relative media paths when no media provider is in context.                          |
| `audioMode`       | `'media'` | `'synthetic'` runs a timer instead of an audio file. Use it whenever the doc has no narration. |
| `audioController` | —         | Your own playback clock (`AudioController`), for hosts that play audio somewhere else.         |
| `processedAudio`  | —         | Lookup for edited clips' rendered audio; see the [media edits guide](../../media-edits.md).    |

### Playback

| Prop                      | Default | What it does                                                                        |
| ------------------------- | ------- | ----------------------------------------------------------------------------------- |
| `autoPlay`                | `false` | Start playing on mount.                                                             |
| `loop`                    | `false` | Restart video playback when the timeline ends.                                      |
| `muted`                   | `false` | Silence audio and video.                                                            |
| `animationsEnabled`       | `true`  | `false` removes layer animations and slide transitions; media and timing still run. |
| `buildsEnabled`           | `true`  | `false` shows every build step at once.                                             |
| `motion`                  | —       | Motion profile override (`'calm'`, `'documentary'`, `'vibrant'`, or a spec).        |
| `onTimeUpdate`, `onEnded` | —       | Clock callbacks.                                                                    |

### Controls and input

| Prop                                 | Default | What it does                                                                                                                |
| ------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `showControls`                       | `true`  | The built-in controls.                                                                                                      |
| `showScrubber`                       | `false` | A scrub bar on its own, when `showControls` is `false` (video mode).                                                        |
| `globalKeyboardShortcuts`            | `false` | Listen for arrow keys on the whole page instead of only when the player has focus.                                          |
| `enableSwipe`                        | `true`  | Swipe between slides on touch screens (slideshow mode).                                                                     |
| `isFullscreen`, `onFullscreenToggle` | —       | Full screen is yours to implement; the controls show a button, and `F` toggles it, only when you pass `onFullscreenToggle`. |
| `onPlaybackStateChange`              | —       | Receives a `PlaybackState` (playing, current time, block index, caption mode, …) on every change.                           |
| `onControlsReady`                    | —       | Receives `play`, `pause`, `toggle`, `seekTo`, `restart`, and the caption and build actions.                                 |
| `onBlockMarkers`                     | —       | Receives the block positions the progress bar draws.                                                                        |

### Appearance

| Prop                                                             | Default      | What it does                                                                                                      |
| ---------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `theme`                                                          | doc's theme  | A `Theme` that replaces the document's own (`squisq-theme`, custom themes, then `standard`).                      |
| `surface`                                                        | —            | Light or dark paper over the theme, or `'auto'` to follow the system setting.                                     |
| `forceViewport`                                                  | window shape | The slide size to compose for, such as `VIEWPORT_PRESETS.portrait`.                                               |
| `showCoverSlide`                                                 | frontmatter  | Show the managed cover slide (`squisq-cover-slide`, default on).                                                  |
| `coverSlideTemplate`, `coverSlideDuration`, `coverSlidePlayback` | frontmatter  | The cover's look, how long it stays, and whether it delays the story (`'preroll'`) or sits over it (`'overlay'`). |
| `videoPresentation`, `pipSize`, `pipShape`, `pipPosition`        | frontmatter  | Where scheduled video sits relative to the slide, for presenter recordings.                                       |

### Captions

Captions show automatically when the document has a caption track; `markdownToDoc` builds one from
the text, timed by reading speed, and a narration take re-times it to the voice.

| Prop               | Default      | What it does                                                                      |
| ------------------ | ------------ | --------------------------------------------------------------------------------- |
| `captionsEnabled`  | on           | `false` starts with captions off. The CC button still cycles through them.        |
| `captionStyle`     | `'standard'` | `'standard'` (a small badge) or `'social'` (large words, active one highlighted). |
| `captionPosition`  | per style    | `'top'`, `'center'`, or `'bottom'`.                                               |
| `onCaptionsToggle` | —            | Called when the viewer turns captions on or off.                                  |

### Linear mode only

`showCodeCopyButton`, `onCopyCode`, and `fenceRenderers` apply to the page rendition's Markdown
sections. `tableContentRenderer` replaces how table layers draw on slides.

The [API reference](../../API.md#docplayer) lists every prop.

## Drive the player from your own UI

Hide the built-in controls and use the state and action callbacks:

```tsx
import { useCallback, useMemo, useState } from 'react';
import { buildPreviewDoc, markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { DocPlayer, type PlaybackActions, type PlaybackState } from '@bendyline/squisq-react';

type Controls = PlaybackActions & { play: () => void; pause: () => void };

export function NarratedTour({ source }: { source: string }) {
  const doc = useMemo(() => buildPreviewDoc(markdownToDoc(parseMarkdown(source))), [source]);
  const [state, setState] = useState<PlaybackState | null>(null);
  const [controls, setControls] = useState<Controls | null>(null);
  const handleControls = useCallback((next: Controls) => setControls(next), []);

  return (
    <div>
      <DocPlayer
        doc={doc}
        audioMode={doc.audio.segments.some((s) => s.src) ? 'media' : 'synthetic'}
        showControls={false}
        captionStyle="social"
        captionPosition="bottom"
        onPlaybackStateChange={setState}
        onControlsReady={handleControls}
      />
      <button onClick={() => controls?.toggle()}>{state?.isPlaying ? 'Pause' : 'Play'}</button>
      <span>
        Block {(state?.currentBlockIndex ?? 0) + 1} of {state?.totalBlocks ?? 0}
      </span>
    </div>
  );
}
```

`onControlsReady` fires again whenever the actions change (`toggle` closes over the playing state),
so keep the latest object rather than the first. The package also exports the built-in control
strips — `DocControlsOverlay`, `DocControlsBottom`, `DocControlsSidebar`, `DocControlsSlideshow`,
`DocProgressBar` — and `DocPlayerWithSidebar`, a player with a navigation sidebar, if you'd rather
rearrange them than build your own.

## Capture frames with the render API

Render mode is for headless export: it hides the controls, runs a deterministic clock, and hands
you an instance API through `onRenderAPIReady`.

```tsx
import { useCallback, useEffect, useState } from 'react';
import type { Doc } from '@bendyline/squisq/schemas';
import { DocPlayer, type SquisqRenderAPI } from '@bendyline/squisq-react';

export function FrameCapture({ doc, onFrame }: { doc: Doc; onFrame: (t: number) => Promise<void> }) {
  const [api, setApi] = useState<SquisqRenderAPI | null>(null);
  const handleApi = useCallback((next: SquisqRenderAPI | null) => setApi(next), []);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      const duration = api.getDuration();
      for (let t = 0; t <= duration && !cancelled; t += 1 / 30) {
        await api.seekTo(t); // resolves once the frame is painted and its media is ready
        await onFrame(t);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, onFrame]);

  return (
    <DocPlayer
      doc={doc}
      renderMode
      audioMode="synthetic"
      forceViewport={{ width: 1280, height: 720, name: '720p' }}
      onRenderAPIReady={handleApi}
    />
  );
}
```

| Method                                                                | Returns                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------ |
| `seekTo(time)`                                                        | A promise that resolves when that moment is ready to capture |
| `getRenderedTime()`                                                   | The time the DOM currently shows                             |
| `getDuration()`, `getViewport()`                                      | Timeline length in seconds; the composed size in CSS pixels  |
| `getBlocks()`, `getAudioSegments()`, `getCaptions()`, `getChapters()` | Timing metadata for muxing and chapter marks                 |
| `showCover()`, `hideCover()`, `hasCoverBlock()`                       | Control the cover slide during capture                       |

The callback receives the API only when `renderMode` is on (or the page URL has `?debug=true`);
otherwise it receives `null`. It receives `null` again on unmount. A dashboard publishes a smaller
version: `seekTo` waits for images and fonts, and the duration is 0. You rarely need to drive this
yourself: [Producing video and images](video-and-images.md) covers the export components built on
it.

## Scrolling pages with `LinearDocView`

`LinearDocView` renders the Page rendition directly, without a player around it:

```tsx
import { useMemo } from 'react';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { LinearDocView } from '@bendyline/squisq-react';

export function FieldReport({ source }: { source: string }) {
  const doc = useMemo(() => markdownToDoc(parseMarkdown(source)), [source]);
  return <LinearDocView doc={doc} basePath="/reports/q3" variant="document" showCodeCopyButton />;
}
```

```markdown preview=page
# Harbor survey, spring

The north basin after the winter storms.

## Moorings {[statHighlight]}

**42** moorings inspected, six chains replaced

## Next steps

- Dredge the channel before June
- Replace the two damaged buoys
```

| Prop                        | Default      | What it does                                                                            |
| --------------------------- | ------------ | --------------------------------------------------------------------------------------- |
| `doc` / `markdown`          | —            | As on `DocPlayer`.                                                                      |
| `theme`                     | doc's theme  | A `Theme` that replaces the document's own, as on `DocPlayer`.                          |
| `variant`                   | `'page'`     | `'document'` reads as a report: a title masthead, a heading scale, flat backgrounds.    |
| `showCover`                 | `true`       | The hero section built from the document's cover.                                       |
| `surface`                   | —            | Light or dark paper, or `'auto'`.                                                       |
| `thinMargins`               | `false`      | Tight padding for chat replies and side panels.                                         |
| `imageDisplayMode`          | `'inline'`   | `'thumbnail'` fits each image in a 100×100 box.                                         |
| `viewport`                  | landscape    | The size diagrams, trees, and maps are composed at before they're scaled into the page. |
| `basePath`                  | `'/'`        | Prefix for relative media paths. Note the default differs from `DocPlayer`'s `'.'`.     |
| `htmlPolicy`, `linkSchemes` | `'sanitize'` | Raw HTML handling and extra link schemes for the Markdown sections.                     |
| `fenceRenderers`            | —            | Your own components for claimed code-fence languages.                                   |
| `globalKeyboardShortcuts`   | `false`      | Let the arrow keys scroll the page without focus.                                       |

See [Page mode](../../guide/page-mode.md) for how themes art-direct the page.

## One-screen dashboards with `DashboardView`

```tsx
import { useMemo } from 'react';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { DashboardView } from '@bendyline/squisq-react';

export function OpsBoard({ source }: { source: string }) {
  const doc = useMemo(() => markdownToDoc(parseMarkdown(source)), [source]);
  return <DashboardView doc={doc} layout="auto" style="card" documentTitle="Ops board" />;
}
```

```markdown preview=dashboard
---
title: Harbor operations
---

# Harbor operations

## Moorings {[statHighlight]}

**42** inspected this week

## Channel depth {[statHighlight]}

**3.4 m** at low tide

## Open work

- Replace two buoys
- Survey the east wall
```

`DashboardView` requires a `doc` (it has no `markdown` prop) and resolves the document's theme when
you don't pass `theme`. `layout`, `showTitle`, `style`, and `documentTitle` override frontmatter as
on `DocPlayer`; `viewport` sets the canvas shape (default landscape), and `muted` defaults to
`true`. The canvas is width-driven; to contain-fit it in a box of fixed height, define
`--squisq-dashboard-fit-width` on a wrapper, as the editor's preview does.

## Render plain Markdown with `MarkdownRenderer`

For chat replies, comments, and other text that isn't a document, `MarkdownRenderer` renders the
Markdown AST as HTML with no slides or sections:

```tsx
import { useMemo } from 'react';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { MarkdownRenderer } from '@bendyline/squisq-react';

export function ChatReply({ text }: { text: string }) {
  const nodes = useMemo(() => parseMarkdown(text).children, [text]);
  return <MarkdownRenderer nodes={nodes} htmlPolicy="strip" showCodeCopyButton />;
}
```

`htmlPolicy` is `'sanitize'` by default (unsafe tags, handlers, and executable URLs removed);
`'strip'` drops raw HTML and `'trusted'` keeps it. A top-level paragraph that is only a link to a
YouTube, Vimeo, Loom, or Wistia page renders as the player, and ` ```mermaid ` and ` ```svg `
fences render as pictures. Pass `theme` so Mermaid diagrams pick up your colors, and
`fenceRenderers` to claim other fence languages.

## Render one block with `BlockRenderer`

`BlockRenderer` draws a single slide as SVG. It takes a block that already has layers, so
materialize the block first with `materializeBlockLayers`:

```tsx
import { useMemo } from 'react';
import {
  buildPreviewDoc,
  markdownToDoc,
  materializeBlockLayers,
  resolveThemeForDoc,
} from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { Block } from '@bendyline/squisq/schemas';
import { BlockRenderer } from '@bendyline/squisq-react';

export function SlideThumbnail({ source }: { source: string }) {
  const thumb = useMemo(() => {
    const doc = buildPreviewDoc(markdownToDoc(parseMarkdown(source)));
    const theme = resolveThemeForDoc(doc);
    const viewport = { width: 1920, height: 1080, name: 'Thumbnail' };
    const first = doc.blocks[0];
    const { layers } = materializeBlockLayers(first, { theme, viewport });
    return { block: { ...first, layers } as Block, theme, viewport };
  }, [source]);

  return (
    <div style={{ width: 320, aspectRatio: '16 / 9' }}>
      <BlockRenderer
        block={thumb.block}
        blockTime={0}
        basePath="."
        viewport={thumb.viewport}
        theme={thumb.theme}
        animationsEnabled={false}
      />
    </div>
  );
}
```

`blockTime` is the time within the block in seconds; `0` with animations off gives a still. The
props you're most likely to set are `growTextToFit` (enlarge text to fill the slide, as the
slideshow does), `videoEmbeds` (`'poster'` by default, `'player'` for a live video, `'placeholder'`
for capture), and `staticMedia` (freeze animated SVG). The
[templates concept page](../concepts/templates.md) explains what `materializeBlockLayers` returns.

## Resolve media

Every image, video, and timed clip URL in a document goes through `useMediaUrl`. Without a media
provider, a relative path is joined to `basePath`; absolute, `data:`, and `blob:` URLs pass through
unchanged. To serve media from somewhere else — files the user dropped in, IndexedDB, a zip —
provide a `MediaProvider` through `MediaContext`. A `ContentContainer` becomes one with
`createMediaProviderFromContainer`:

```tsx
import { useEffect, useMemo, type ReactNode } from 'react';
import { MediaContext } from '@bendyline/squisq-react';
import { createMediaProviderFromContainer, type ContentContainer } from '@bendyline/squisq/storage';

export function WorkspaceMedia({
  container,
  children,
}: {
  container: ContentContainer;
  children: ReactNode;
}) {
  const provider = useMemo(() => createMediaProviderFromContainer(container), [container]);
  useEffect(() => () => provider.dispose(), [provider]);
  return <MediaContext.Provider value={provider}>{children}</MediaContext.Provider>;
}
```

Wrap any of the components above in `<WorkspaceMedia container={…}>` and `![Harbor](harbor.jpg)`
loads from the container. With a provider in place, a path the provider can't find stays blank
rather than falling back to the page's own server. The [storage concept page](../concepts/storage.md)
covers containers.

Two exceptions to know about:

- Narration segments in `doc.audio` are fetched from `basePath` directly, not through the
  provider. Use absolute, `data:`, or `blob:` URLs for them when your audio isn't beside the page.
- A local SVG image (a relative path, or a `blob:` or `data:` URL) is read and passed through
  Squisq's SVG sanitizer, and the sanitized copy is what appears. A remote SVG URL is used as is.

To restrict which URLs a document may load, provide a `ResourcePolicy` through
`ResourcePolicyContext`. `LOCAL_ONLY_RESOURCE_POLICY` from `@bendyline/squisq/markdown` blocks every
remote URL; the default allows `http(s)`, relative, `data:`, and `blob:` URLs.

## Styles

`import '@bendyline/squisq-react/styles'` loads the player's styles and slide animations, the JSON
viewer's styles, and the Font Awesome webfonts that inline icons use. Without it, slides render but transitions and
icons don't; in development, the player warns once in the console when the stylesheet is missing.

## Hooks for custom players

Most apps never need these; they're the pieces `DocPlayer` is built from.

| Hook                                 | Use it to                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `useDocPlayback(doc, time, options)` | Expand a doc into renderable blocks and get the playback state and actions for a given time.     |
| `useAudioSync(audioRef, track, …)`   | Drive a timeline from an `<audio>` element (or a synthetic clock); returns an `AudioController`. |
| `useMediaSchedule`                   | Find the timed clips active at the current time.                                                 |
| `useMediaProvider`, `useMediaUrl`    | Read the provider from context, or resolve one media path the way the layers do.                 |
| `useViewportOrientation`             | Pick the landscape, portrait, or square preset from the window's shape.                          |
| `useAutoSurface(enabled)`            | Follow the system light/dark setting.                                                            |

See [Hooks](../../API.md#hooks) in the API reference for their signatures.

## Smaller imports

The package root exports everything. Subpaths load less:

| Import                             | Contains                                                    |
| ---------------------------------- | ----------------------------------------------------------- |
| `@bendyline/squisq-react/player`   | `DocPlayer`, `BlockRenderer`, `FlashcardView`, the controls |
| `@bendyline/squisq-react/page`     | `LinearDocView` and the page section components             |
| `@bendyline/squisq-react/hooks`    | The hooks and `MediaContext`                                |
| `@bendyline/squisq-react/markdown` | `MarkdownRenderer`, `MermaidDiagram`, `VideoEmbedFrame`     |
| `@bendyline/squisq-react/layers`   | The individual layer components                             |
| `@bendyline/squisq-react/graph`    | `DiagramViewer`; see [Graph layout](graph-layout.md)        |

## Pitfalls

- **Video stands still, or says the audio can't load.** A document without narration has no
  audio file to drive the clock. Pass `audioMode="synthetic"` whenever no segment in
  `doc.audio.segments` has a `src`, as the examples above do.
- **The composition follows the window, not the box.** Without `forceViewport`, the player chooses
  landscape, portrait, or square from the browser window's shape. A landscape deck in a tall
  phone window is composed as portrait. Pass `forceViewport` to pin it.
- **Slides look different from the editor.** You passed `markdownToDoc` output to a slideshow.
  Run `buildPreviewDoc` first.
- **Unstable callbacks.** `onRenderAPIReady` and `onControlsReady` run from effects that depend on
  them, so an inline arrow function re-runs them on every render. Pass a `useCallback` or a state
  setter.
- **Several players on one page.** Leave `globalKeyboardShortcuts` off (the default) so the arrow
  keys move only the focused player.
- **Server rendering.** The components render to a string on the server without throwing, but
  text fitting, captions, and media run in effects, and the server can't know the window shape.
  Render players on the client only (with your framework's client-only boundary) to avoid a
  hydration mismatch.

## Related

- [API reference: `@bendyline/squisq-react`](../../API.md#bendylinesquisq-react)
- [Embedding the editor](editor.md) — the editor's preview is this same player
- [Standalone player](standalone-player.md) — the player without React or a build step
- [Themes concept page](../concepts/themes.md) and [document model](../concepts/document-model.md)
