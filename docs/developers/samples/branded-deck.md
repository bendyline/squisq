---
title: Branded deck
description: Build a brand theme with compileTheme, present a deck in it with DocPlayer, and export the same deck to PowerPoint in the same theme.
---

# Branded deck

Fernway Outfitters wants its quarterly review in the company colors and typefaces, in the browser and in PowerPoint. This sample defines the brand once as a Squisq theme, plays the deck in a React app, and exports a `.pptx` whose slides, theme colors, and fonts match, from a button in the app or from a script.

What it demonstrates:

- `compileTheme` from `@bendyline/squisq/schemas`: a complete, validated theme from a few brand colors, two fonts, and a built-in theme to inherit the rest from.
- Passing a `Theme` object to `DocPlayer`, and loading the theme's web fonts with `buildGoogleFontsUrl`.
- How a custom theme reaches the PowerPoint exporter: a `ThemeRegistry` passed to `convert()`, or the theme written into the document's own frontmatter.

## Files

```text
fernway-deck/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.tsx
│   ├── app.css
│   ├── deck.md
│   ├── brandTheme.ts
│   ├── exportDeck.ts
│   └── App.tsx
└── scripts/
    ├── export-pptx.ts
    └── embed-theme.ts
```

**`package.json`**

```json
{
  "name": "fernway-deck",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "export:pptx": "tsx scripts/export-pptx.ts",
    "embed-theme": "tsx scripts/embed-theme.ts"
  },
  "dependencies": {
    "@bendyline/squisq": "2.13.6",
    "@bendyline/squisq-formats": "2.8.7",
    "@bendyline/squisq-react": "2.12.18",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@types/node": "25.9.9",
    "@types/react": "18.3.31",
    "@types/react-dom": "18.3.7",
    "@vitejs/plugin-react": "6.1.1",
    "tsx": "4.23.15",
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
    "types": ["vite/client", "node"]
  },
  "include": ["src", "scripts"]
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
    <title>Fernway Q4 Review</title>
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

**`src/app.css`**

```css
body {
  margin: 0;
  background: #e9e4d8;
  font-family: 'DM Sans', system-ui, sans-serif;
  color: #1e2a24;
}
main {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px;
}
header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}
header h1 {
  margin: 0 auto 0 0;
  font:
    400 1.6rem 'DM Serif Display',
    Georgia,
    serif;
}
header button {
  padding: 8px 16px;
  border: 0;
  border-radius: 4px;
  background: #1f4d3a;
  color: #fff;
  font: inherit;
  cursor: pointer;
}
```

The deck. `squisq-cover-slide: false` turns off the automatic cover slide; see [The cover slide](#the-cover-slide) for why.

**`src/deck.md`**

```markdown
---
title: Fernway Q4 Review
squisq-cover-slide: false
---

# Fernway Q4 Review

Outdoor gear for the long way around. Quarterly results for the leadership team.

## Revenue this quarter {[statHighlight]}

**$4.8M** in sales, up 22% on the same quarter last year.

## Sales by channel {[columnChart]}

| Channel   | Sales ($K) |
| --------- | ---------- |
| Online    | 2,150      |
| Flagship  | 1,320      |
| Wholesale | 940        |
| Pop-up    | 390        |

## What customers told us {[quote]}

> The rain shell survived a week on the Olympic coast. It's the only jacket I pack now.
> — Customer review, November

## Priorities for Q1

- Open the Portland flagship in March
- Bring the repair program to every store
- Cut packaging plastic by half
```

The brand, defined once and imported everywhere else.

**`src/brandTheme.ts`**

```ts
import { THEMES, compileTheme, fontStack } from '@bendyline/squisq/schemas';

/**
 * Fernway's brand theme: the standard theme's layouts and motion, in
 * Fernway's colors and type. compileTheme fills every field the partial
 * leaves out from the base, derives the rest of the palette from the seed
 * colors, and validates the result (it throws on an invalid theme).
 */
export const fernwayTheme = compileTheme(
  {
    id: 'fernway',
    name: 'Fernway',
    description: 'Fernway Outfitters brand theme',
    seedColors: {
      primary: '#1f4d3a', // forest green
      accent: '#c8743a', // copper
      background: '#faf6ee', // canvas cream
      text: '#1e2a24',
    },
    // Accent families for stats, charts, and per-block `colorScheme=` params;
    // the first is the default. On a light theme each is a pale fill, a deep
    // text color, and a mid-tone accent, like the built-in light themes.
    colorSchemes: {
      forest: { bg: '#e3efe8', text: '#1f4d3a', accent: '#2f6b4f' },
      copper: { bg: '#f6e6d8', text: '#8a4a1f', accent: '#c8743a' },
      lake: { bg: '#e0eef1', text: '#2a5763', accent: '#3f7d8c' },
    },
    typography: {
      titleFont: fontStack('dm-serif'),
      bodyFont: fontStack('dm-sans'),
    },
    style: { borderRadius: 4 },
  },
  { base: THEMES.standard },
);
```

The export, shared by the app's button and the script. It runs unchanged in the browser and in Node.

**`src/exportDeck.ts`**

```ts
import { createThemeRegistry } from '@bendyline/squisq/schemas';
import { convert, type ConversionResult } from '@bendyline/squisq-formats/registry';
import { fernwayTheme } from './brandTheme';

/**
 * Export the deck to PowerPoint in the Fernway theme. Runs in the browser
 * and in Node. The registry makes the theme id resolvable without writing
 * the theme into the document.
 */
export function exportDeck(markdown: string): Promise<ConversionResult> {
  return convert({ kind: 'markdown', markdown, baseName: 'fernway-q4-review' }, 'pptx', {
    themeId: fernwayTheme.id,
    themeRegistry: createThemeRegistry([fernwayTheme]),
  });
}
```

**`src/App.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { DocPlayer } from '@bendyline/squisq-react';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { buildPreviewDoc, markdownToDoc } from '@bendyline/squisq/doc';
import { buildGoogleFontsUrl } from '@bendyline/squisq/schemas';
import { fernwayTheme } from './brandTheme';
import { exportDeck } from './exportDeck';
import deckMarkdown from './deck.md?raw';

// The player names the theme's fonts but does not load them: add the
// Google Fonts stylesheet for DM Serif Display and DM Sans once.
const fontsUrl = buildGoogleFontsUrl([
  fernwayTheme.typography.titleFont,
  fernwayTheme.typography.bodyFont,
]);
if (fontsUrl) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = fontsUrl;
  document.head.appendChild(link);
}

export function App() {
  const slides = useMemo(() => buildPreviewDoc(markdownToDoc(parseMarkdown(deckMarkdown))), []);
  const [status, setStatus] = useState('');

  async function downloadPptx() {
    setStatus('Exporting…');
    try {
      const result = await exportDeck(deckMarkdown);
      const url = URL.createObjectURL(new Blob([result.bytes.slice()], { type: result.mimeType }));
      const link = document.createElement('a');
      link.href = url;
      link.download = result.suggestedFilename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`Saved ${result.suggestedFilename}`);
    } catch (err: unknown) {
      setStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <main>
      <header>
        <h1>Fernway Q4 Review</h1>
        <button type="button" onClick={downloadPptx}>
          Download .pptx
        </button>
        <span role="status">{status}</span>
      </header>
      <DocPlayer doc={slides} displayMode="slideshow" audioMode="synthetic" theme={fernwayTheme} />
    </main>
  );
}
```

**`scripts/export-pptx.ts`**

```ts
// npx tsx scripts/export-pptx.ts  →  fernway-q4-review.pptx
import { readFile, writeFile } from 'node:fs/promises';
import { exportDeck } from '../src/exportDeck';

const result = await exportDeck(await readFile('src/deck.md', 'utf8'));
await writeFile(result.suggestedFilename, result.bytes);
console.log(
  `Wrote ${result.suggestedFilename} (${(result.bytes.byteLength / 1024).toFixed(1)} KB)`,
);
for (const warning of result.warnings) console.warn(`  ⚠ ${warning}`);
```

**`scripts/embed-theme.ts`**

```ts
// npx tsx scripts/embed-theme.ts  →  deck.fernway.md
// A copy of the deck whose frontmatter carries the Fernway theme, so the
// Squisq editor, the squisq CLI, and convert() all render it on brand with
// no extra setup.
import { readFile, writeFile } from 'node:fs/promises';
import { writeCustomThemesToFrontmatter } from '@bendyline/squisq/doc';
import { setFrontmatterValues } from '@bendyline/squisq/markdown';
import { fernwayTheme } from '../src/brandTheme';

const source = await readFile('src/deck.md', 'utf8');
const branded = setFrontmatterValues(source, {
  'squisq-custom-themes': writeCustomThemesToFrontmatter([fernwayTheme]),
  'squisq-theme': fernwayTheme.id,
});
await writeFile('deck.fernway.md', branded);
console.log('Wrote deck.fernway.md');
```

## Run it

```bash
npm install
npm run dev
```

Open the address Vite prints. Click the player and use the arrow keys, or the buttons in its corner, to step through the five slides. **Download .pptx** saves the PowerPoint file.

To export from the command line instead:

```bash
npx tsx scripts/export-pptx.ts
```

```text
Wrote fernway-q4-review.pptx (37.7 KB)
```

PowerPoint shows the deck in DM Serif Display and DM Sans when those fonts are installed, and substitutes others when they aren't. The colors need nothing installed.

## How it works

### Building the theme

`compileTheme(partial, { base })` deep-merges your partial theme over the base, so everything you leave out (layouts, motion, page art direction) is inherited from `standard`, and records `basedOn: 'standard'` on the result. Then it fills in the palette from `seedColors` and validates the theme, throwing if anything is invalid.

From the four seed colors, the Fernway palette comes out as:

| Color             | Value     | From                      |
| ----------------- | --------- | ------------------------- |
| `primary`         | `#1f4d3a` | the `primary` seed        |
| `secondary`       | `#41564c` | derived from `primary`    |
| `background`      | `#faf6ee` | the `background` seed     |
| `backgroundLight` | `#ede9e1` | derived from `background` |
| `text`            | `#1e2a24` | the `text` seed           |
| `textMuted`       | `#5f6d66` | derived from `text`       |
| `highlight`       | `#c8743a` | the `accent` seed         |
| `warning`         | `#fc8181` | the default               |

To pin any of these, pass `colors` alongside `seedColors`; explicit colors win over derived ones. Fonts are replaced outright rather than merged, and so is `colorSchemes`, which is why the brand's three schemes replace the six that `standard` defines rather than adding to them.

### Color schemes

`colorSchemes` are the accent families templates draw on: the big number of a `{[statHighlight]}` uses one, and chart series cycle through them. A block can ask for one by name with a `colorScheme=` parameter; without one, or with a name the theme lacks, it gets the theme's first scheme. Leave out `colorSchemes` and the brand slides would keep `standard`'s blue.

Each scheme is `{ bg, text, accent }`. Built-in light themes use a pale fill, a deep text color, and a mid-tone accent, and so does this one. `accentToColorScheme(hex)` from the same module builds a scheme from one color, but its result has a dark fill and light text, made for dark themes; on a cream background its text color is too light to read.

### Fonts

A theme refers to fonts by stack id: `fontStack('dm-serif')` is `{ stackId: 'dm-serif' }`, the curated DM Serif Display stack, with fallbacks. The player names the font in its styles but doesn't load it. `buildGoogleFontsUrl` turns the theme's font references into one Google Fonts stylesheet URL (or `null` when none of them come from Google Fonts), and `App.tsx` adds it to the page. The PowerPoint exporter writes the font names into the deck's theme.

### How the theme reaches PowerPoint

`DocPlayer` takes the `Theme` object itself. The exporters work from a theme id, and resolve it in this order:

1. The `themeId` option passed to `convert()` (or to `docToPptx`), else the document's `squisq-theme` frontmatter.
2. That id is looked up in the document's own custom themes (its `squisq-custom-themes` frontmatter), then in the `themeRegistry` you pass, then among the built-in themes.
3. An id found nowhere falls back to `standard`, without an error.

`exportDeck` passes `themeId: 'fernway'` and a registry made with `createThemeRegistry([fernwayTheme])`, which is all the exporter needs; the deck's Markdown stays brand-neutral. If you forget the registry, step 3 applies and the deck comes out in `standard`, so check the colors of the first export. `docToPptx(doc, { themeId, themeRegistry })` takes the same two options, as do the `docx`, `pdf`, `html`, `htmlzip`, and `epub` formats.

### Carrying the theme in the document

`scripts/embed-theme.ts` takes the other route: it writes a copy of the deck whose frontmatter holds the theme, using the same two keys the Squisq editor writes when you save a custom theme into a document.

```bash
npx tsx scripts/embed-theme.ts
```

```text
Wrote deck.fernway.md
```

```yaml
---
title: Fernway Q4 Review
squisq-cover-slide: false
squisq-custom-themes: { 'fernway': { 'schemaVersion': '1', 'id': 'fernway', 'name': 'Fernway', … } }
squisq-theme: fernway
---
```

`squisq-custom-themes` is the theme as compact JSON keyed by id (`writeCustomThemesToFrontmatter` writes it, and malformed entries are dropped when it is read back), and `squisq-theme` selects it. A document carrying its theme renders on brand anywhere, with no registry: in the Squisq editor, where the theme also appears in the theme picker; in `DocPlayer` without a `theme` prop; in `convert()` without options; and in the [CLI](../../guide/cli.md), which writes `deck.fernway.pptx` beside the source:

```bash
npm install --save-dev @bendyline/squisq-cli@2.9.21
npx squisq convert deck.fernway.md -f pptx
```

Embed the theme when the document travels without your code; use a registry when your app owns the brand and the documents shouldn't each carry a copy.

### The cover slide

A document with a title gets an automatic cover slide in the slideshow and in PowerPoint. Without a cover image, the built-in `standard` theme draws it with a quiet tint, but every other theme, this one included, paints a radial glow from the primary color out to the background. With a dark primary on a light background, that puts dark title text on dark green. The deck sets `squisq-cover-slide: false`, which both the player and the PowerPoint exporter honor, and opens with its own first section instead. A brand theme with a light primary on a dark background can keep the cover.

## Ideas for extending it

- **A dark variant.** Compile a second theme on `THEMES['standard-dark']` with light text seeds, and give your deck a switch between the two.
- **Other formats.** Change `'pptx'` to `'docx'`, `'pdf'`, or `'html'` in `exportDeck`; each takes the same theme options.
- **Your designers' tools.** Teams that design in the Squisq editor can save the theme to a document from its theme designer, then copy the `squisq-custom-themes` value out of the frontmatter.
- **Themes from Office files.** `inferThemeFromFile(bytes)` from `@bendyline/squisq-formats/infer` reads the colors and fonts of an existing `.pptx`, `.docx`, or `.xlsx`; the `theme` in its result is a compiled theme, a quick start from a brand template you already have.
- **More on themes.** [Themes](../concepts/themes.md) covers the theme model, and the [theme guide](../../guide/themes.md#custom-themes) covers custom themes from the author's side.
