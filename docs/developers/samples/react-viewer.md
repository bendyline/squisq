---
title: React viewer
description: A Vite and React app that previews Markdown as a slideshow, a page, or a dashboard, in any built-in theme.
---

# React viewer

Type Markdown on the left and watch it render on the right. A row of buttons switches between the three renditions of the same document: the **slideshow** (`DocPlayer`), the scrolling **page** (`LinearDocView`), and the one-canvas **dashboard**. A menu built from `getThemeSummaries()` restyles it in any of the 11 built-in themes.

What it demonstrates:

- Parsing Markdown with `parseMarkdown` and `markdownToDoc`, once per edit.
- Feeding each rendition the document shape it expects: the slide projection from `buildPreviewDoc` for the slideshow, the document as written for the page and the dashboard.
- Running the slideshow on the player's own clock when there is no narration.
- Resolving a theme by id with `resolveThemeForDoc`.

## Files

```text
react-viewer/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── app.css
    └── starter.md
```

**`package.json`**

```json
{
  "name": "squisq-react-viewer",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@bendyline/squisq": "2.13.6",
    "@bendyline/squisq-react": "2.12.18",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@types/react": "18.3.31",
    "@types/react-dom": "18.3.7",
    "@vitejs/plugin-react": "6.1.1",
    "typescript": "5.9.3",
    "vite": "8.3.4"
  }
}
```

**`tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

**`vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

**`index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Squisq viewer</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**`src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@bendyline/squisq-react/styles';
import './app.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

**`src/App.tsx`**

```tsx
import { useDeferredValue, useMemo, useState } from 'react';
import { DocPlayer, LinearDocView } from '@bendyline/squisq-react';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { buildPreviewDoc, markdownToDoc, resolveThemeForDoc } from '@bendyline/squisq/doc';
import { getThemeSummaries } from '@bendyline/squisq/schemas';
import starter from './starter.md?raw';

type Rendition = 'slideshow' | 'page' | 'dashboard';

const RENDITIONS: { id: Rendition; label: string }[] = [
  { id: 'slideshow', label: 'Slideshow' },
  { id: 'page', label: 'Page' },
  { id: 'dashboard', label: 'Dashboard' },
];

// The 11 built-in themes: { id, name, description }.
const THEMES = getThemeSummaries();

export function App() {
  const [markdown, setMarkdown] = useState(starter);
  const [rendition, setRendition] = useState<Rendition>('slideshow');
  // '' means "use the document's own theme" (its `squisq-theme` frontmatter).
  const [themeId, setThemeId] = useState('');

  // Typing stays responsive: React renders the preview from a deferred copy.
  const source = useDeferredValue(markdown);
  const doc = useMemo(() => markdownToDoc(parseMarkdown(source)), [source]);
  // Slideshow plays the slide projection, the same one the Squisq editor previews.
  const slides = useMemo(() => buildPreviewDoc(doc), [doc]);
  const theme = useMemo(() => resolveThemeForDoc(doc, themeId || undefined), [doc, themeId]);

  return (
    <div className="viewer">
      <section className="pane">
        <label className="pane-label" htmlFor="source">
          Markdown
        </label>
        <textarea
          id="source"
          value={markdown}
          spellCheck={false}
          onChange={(event) => setMarkdown(event.target.value)}
        />
      </section>

      <section className="pane">
        <div className="toolbar">
          <div role="group" aria-label="Rendition">
            {RENDITIONS.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={rendition === r.id}
                onClick={() => setRendition(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <label>
            Theme{' '}
            <select value={themeId} onChange={(event) => setThemeId(event.target.value)}>
              <option value="">As written</option>
              {THEMES.map((t) => (
                <option key={t.id} value={t.id} title={t.description}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={`stage stage--${rendition}`}>
          {rendition === 'slideshow' && (
            <DocPlayer
              key="slideshow"
              doc={slides}
              displayMode="slideshow"
              // No narration recorded: advance on the player's own clock.
              audioMode={doc.audio.segments.length > 0 ? 'media' : 'synthetic'}
              theme={theme}
            />
          )}
          {rendition === 'page' && <LinearDocView doc={doc} theme={theme} />}
          {rendition === 'dashboard' && (
            <DocPlayer key="dashboard" doc={doc} displayMode="dashboard" theme={theme} />
          )}
        </div>
      </section>
    </div>
  );
}
```

**`src/app.css`**

```css
* {
  box-sizing: border-box;
}
html,
body,
#root {
  height: 100%;
  margin: 0;
}
body {
  font-family: system-ui, sans-serif;
  color: #1f2933;
  background: #f4f5f7;
}
.viewer {
  display: grid;
  grid-template-columns: minmax(280px, 2fr) 3fr;
  gap: 16px;
  height: 100%;
  padding: 16px;
}
.pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 8px;
}
.pane-label {
  font-weight: 600;
}
textarea {
  flex: 1;
  padding: 12px;
  border: 1px solid #cbd2d9;
  border-radius: 6px;
  font:
    14px/1.5 ui-monospace,
    Menlo,
    monospace;
  resize: none;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
}
.toolbar button {
  padding: 4px 12px;
  border: 1px solid #cbd2d9;
  background: #fff;
  font: inherit;
  cursor: pointer;
}
.toolbar button[aria-pressed='true'] {
  background: #1f2933;
  color: #fff;
}
.stage {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border-radius: 6px;
  background: #fff;
}
/* Page mode scrolls inside the stage; the canvases keep their 16:9 shape. */
.stage--page > * {
  height: 100%;
}
@media (max-width: 800px) {
  .viewer {
    grid-template-columns: 1fr;
    grid-template-rows: 40vh 1fr;
  }
}
```

The document the viewer opens with. Edit it here or in the running app.

**`src/starter.md`**

```markdown
---
title: Trailhead Launch Review
---

# Trailhead Launch Review

How the offline trail-map app did in its first month.

## Downloads in month one {[statHighlight]}

**48,000** installs, twice the launch-plan target.

## Installs by week {[barChart]}

| Week   | Installs |
| ------ | -------- |
| Week 1 | 18,400   |
| Week 2 | 12,100   |
| Week 3 | 9,300    |
| Week 4 | 8,200    |

## What hikers said {[quote]}

> It found the trail when my phone had no bars at all.
> — App store review, Mount Pilchuck

## Next quarter

- Add 25 national forests
- Ship group trip logs
- Launch the Android widget
```

## Run it

```bash
npm install
npm run dev
```

Open the address Vite prints (usually `http://localhost:5173`). Use the arrow buttons on the slideshow, or click it and press the arrow keys. `npm run build` typechecks the project and writes a static build to `dist/`.

## How it works

### One parse, two document shapes

`markdownToDoc(parseMarkdown(source))` turns the Markdown into a `Doc`: one block per heading, nested the way the headings nest. That is the shape the page and the dashboard read.

The slideshow plays a different shape. `buildPreviewDoc(doc)` flattens the blocks into a list of player-ready slides and fills in each slide's template inputs. It is the projection the Squisq editor's own preview plays, and the PowerPoint exporter uses it too, so this viewer, the editor, and a `.pptx` export show the same slides. Skip it and a heading with no `{[template]}` tag renders as a bare section header, without its body text.

The dashboard runs its own projection internally, so it gets the unprojected `doc`, as the page does.

### The slideshow's clock

`buildPreviewDoc` gives the slides a timeline (a few seconds each) backed by an audio segment with no file, a timer for the editor's preview. The player's default `audioMode="media"` would try to load that file and report that the audio could not be loaded. `audioMode="synthetic"` runs the timeline on the player's own clock instead. The viewer switches to `"media"` only when the document carries real narration segments.

### Renditions

`DocPlayer`'s `displayMode` picks the rendition: `"slideshow"` steps through slides with previous and next buttons, and `"dashboard"` arranges every block on one canvas. `"video"` (the default) plays the timeline with a scrubber.

For the page, the viewer renders `LinearDocView` directly. `DocPlayer` with `displayMode="linear"` renders the same component, but using it directly gives you its own props, such as `variant="document"` for a plainer report layout and `showCover` for the title section.

> [!NOTE]
> In `DocPlayer`, `displayMode="page"` does not give you the scrolling page; it plays the document like `"video"`. Use `"linear"` or `LinearDocView`.

The slideshow and dashboard fill their container's width at an aspect ratio that follows the browser window's shape: 16:9 in a wide window, 9:16 in a tall one. The page fills its container's height and scrolls inside it, so its container needs a definite height; that is what the `.stage--page > *` rule in `app.css` provides.

### Themes

`getThemeSummaries()` returns `{ id, name, description }` for each built-in theme, in a stable order. `resolveThemeForDoc(doc, id)` turns an id into a full `Theme`, checking the document's own custom themes (from its `squisq-custom-themes` frontmatter) before the built-ins. With no id it uses the document's `squisq-theme` frontmatter, and falls back to `standard`. Every rendition takes the result through its `theme` prop.

### Styles

`@bendyline/squisq-react/styles` carries the player's animations and icon fonts. Import it once, before anything renders. In development, `DocPlayer` logs a warning when it is missing.

## Ideas for extending it

- **Images.** Relative image paths resolve against the site, so files in Vite's `public/` folder work as written: put `harbor.jpg` in `public/images/` and write `![Harbor](images/harbor.jpg)`. For images a user uploads, store them in a `MemoryContentContainer` and wrap the preview in `MediaContext.Provider` with `createMediaProviderFromContainer(container)`, as the [editor app](editor-app.md) does.
- **Shapes.** Pass `forceViewport={VIEWPORT_PRESETS.portrait}` (from `@bendyline/squisq/schemas`) to preview a vertical deck or dashboard.
- **Dashboard layouts.** `DocPlayer` takes `dashboardLayout` (a layout id such as `grid-2x2`, or `auto`) and `dashboardStyle` (`basic`, `card`, `panel`, or `accent`). See [Dashboards](../../guide/dashboards.md).
- **Remember the text.** Save `markdown` to `localStorage` in an effect and read it back as the initial state.
- **A real editor.** Swap the textarea for the full editor, with its own preview built in: see the [editor app](editor-app.md).
