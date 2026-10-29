---
title: Quick start
description: Render a Markdown document as a slideshow and as a scrolling page in React, then convert it to Word and PowerPoint from Node.
---

# Quick start

Three short walkthroughs, all using the same document: a slideshow in a React app, the same
document as a scrolling page, and a Node script that turns it into `.docx` and `.pptx` files. Each
one is complete — copy the files and run them.

## The document

All three walkthroughs use this field report. Save it as `report.ts` for the React walkthroughs,
and as `harbor-survey.md` (the part between the backticks) for the Node one.

```ts
// report.ts
export const report = `---
title: Harbor Survey 2026
squisq-theme: documentary
---

# Harbor Survey 2026

Three weeks of dives along the north harbor, from the breakwater to the fuel dock.

## Water quality {[statHighlight]}

**92%** of water samples passed the summer clarity test.

## What the divers saw {[quote]}

> The kelp line has moved twenty meters closer to the pier.
> — Mara Okafor, dive lead

## Next steps

- Repair the east breakwater before the winter storms
- Re-test the fuel dock in April
- Publish the full survey to the harbor board
`;
```

Each heading becomes a block. `{[statHighlight]}` and `{[quote]}` choose those blocks' templates;
the unannotated "Next steps" section is a list, so Squisq picks the list template on its own (see
[automatic templates](../guide/markup.md#automatic-templates)). The `squisq-theme` frontmatter key
selects a built-in [theme](concepts/themes.md).

Here is how it renders:

```markdown preview theme=documentary nosource
# Harbor Survey 2026

Three weeks of dives along the north harbor, from the breakwater to the fuel dock.

## Water quality {[statHighlight]}

**92%** of water samples passed the summer clarity test.

## What the divers saw {[quote]}

> The kelp line has moved twenty meters closer to the pier. — Mara Okafor, dive lead

## Next steps

- Repair the east breakwater before the winter storms
- Re-test the fuel dock in April
- Publish the full survey to the harbor board
```

## Show it as a slideshow

You need a React + TypeScript app (for example one made from Vite's `react-ts` template) with the
core and React packages installed:

```bash
npm install @bendyline/squisq @bendyline/squisq-react
```

Create the slideshow component:

```tsx
// Slideshow.tsx
import { useMemo } from 'react';
import { DocPlayer } from '@bendyline/squisq-react';
import { buildPreviewDoc, markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';

export function Slideshow({ markdown }: { markdown: string }) {
  const { slides, hasAudio } = useMemo(() => {
    const doc = markdownToDoc(parseMarkdown(markdown));
    return { slides: buildPreviewDoc(doc), hasAudio: doc.audio.segments.length > 0 };
  }, [markdown]);

  return (
    <DocPlayer doc={slides} displayMode="slideshow" audioMode={hasAudio ? 'media' : 'synthetic'} />
  );
}
```

Mount it, and import the stylesheet once:

```tsx
// main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@bendyline/squisq-react/styles';
import { Slideshow } from './Slideshow';
import { report } from './report';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main style={{ maxWidth: 960, margin: '0 auto' }}>
      <Slideshow markdown={report} />
    </main>
  </StrictMode>,
);
```

Start your dev server. The player fills the width of its container at the slide's aspect ratio;
click it and use the arrow keys, or the on-screen controls, to step through the slides.

What each step does:

1. **`parseMarkdown`** turns the source into a `MarkdownDocument` — a typed syntax tree with the
   frontmatter parsed.
2. **`markdownToDoc`** turns that tree into a `Doc`: one block per heading, each with its template,
   timing, and body. See [The document model](concepts/document-model.md).
3. **`buildPreviewDoc`** projects the `Doc` into a flat list of player-ready slides. It is the same
   projection the editor preview, the HTML slideshow export, and the PowerPoint exporter use, so
   your slides match theirs exactly. See [Projections](concepts/projections.md).
4. **`DocPlayer`** draws each slide as SVG. `displayMode="slideshow"` steps through slides on
   demand; the default, `"video"`, plays them on a timeline.

`audioMode` tells the player what drives its clock. This document has no narration, so it runs on
a `'synthetic'` timer. Decide from the document `markdownToDoc` returned: `buildPreviewDoc` always
adds a placeholder clock segment, so the projected document never looks silent.

> [!NOTE]
> `DocPlayer` also accepts `markdown` directly: `<DocPlayer markdown={report} />`. That shortcut
> runs only `markdownToDoc`, not `buildPreviewDoc`, so a heading without a tag renders as a
> heading-only section card and its body text is not shown. Use the projection when you want the
> slides the editor shows.

Other props you will reach for: `theme` (a `Theme` object that overrides the document's own),
`forceViewport` (for example `VIEWPORT_PRESETS.portrait` from `@bendyline/squisq/doc`; by default
the player follows the window's orientation), `globalKeyboardShortcuts` (listen for arrow keys
without focus), and `basePath` (where relative image paths resolve). The
[rendering guide](guides/rendering.md) covers the rest.

## Show it as a page

The same document can render as a scrolling, variable-height page — HTML sections art-directed by
the theme, with SVG only for spatial content such as diagrams and charts. `LinearDocView` runs the
page projection itself, so you pass it the `Doc` from `markdownToDoc` — no `buildPreviewDoc` step.

```tsx
// Page.tsx
import { useMemo } from 'react';
import { LinearDocView } from '@bendyline/squisq-react';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';

export function Page({ markdown }: { markdown: string }) {
  const doc = useMemo(() => markdownToDoc(parseMarkdown(markdown)), [markdown]);

  return <LinearDocView doc={doc} />;
}
```

Render `<Page markdown={report} />` in place of (or below) the slideshow. The page opens with a
cover built from the document's title and first paragraph; pass `showCover={false}` to leave it
out.

Like `DocPlayer`, `LinearDocView` uses the document's own theme — its `squisq-theme` (here,
`documentary`) and any custom themes it carries, resolved with `resolveThemeForDoc` — when you
don't pass `theme`. Pass `theme` only to override it.

```markdown preview=page theme=documentary nosource
# Harbor Survey 2026

Three weeks of dives along the north harbor, from the breakwater to the fuel dock.

## Water quality {[statHighlight]}

**92%** of water samples passed the summer clarity test.

## What the divers saw {[quote]}

> The kelp line has moved twenty meters closer to the pier. — Mara Okafor, dive lead

## Next steps

- Repair the east breakwater before the winter storms
- Re-test the fuel dock in April
- Publish the full survey to the harbor board
```

## Convert it to Word and PowerPoint in Node

The formats package converts documents with no browser and no React. In a Node project with
`"type": "module"` in its `package.json`:

```bash
npm install @bendyline/squisq-formats
```

```ts
// convert-report.ts
import { readFile, writeFile } from 'node:fs/promises';
import { convert, ConversionError } from '@bendyline/squisq-formats/registry';

const markdown = await readFile('harbor-survey.md', 'utf8');

for (const format of ['docx', 'pptx']) {
  try {
    const result = await convert({ kind: 'markdown', markdown, baseName: 'harbor-survey' }, format);
    await writeFile(result.suggestedFilename, result.bytes);
    console.log(`Wrote ${result.suggestedFilename} (${result.bytes.byteLength} bytes)`);
    for (const warning of result.warnings) console.warn(`  ${warning}`);
  } catch (error: unknown) {
    if (error instanceof ConversionError) {
      console.error(`${format}: ${error.code} — ${error.message}`, error.hint ?? '');
    } else {
      throw error;
    }
  }
}
```

Run it with `npx tsx convert-report.ts` (or save it as `convert-report.mjs`, drop the
`: unknown` annotation, and run `node convert-report.mjs`):

```text
Wrote harbor-survey.docx (13488 bytes)
Wrote harbor-survey.pptx (33526 bytes)
```

`convert(source, format, options)` takes a source — Markdown text here, or a `Doc`, or the bytes of
another file — and a target format id, and resolves to the encoded `bytes`, their `mimeType`, a
`suggestedFilename` built from `baseName`, and any non-fatal `warnings`. Failures throw a
`ConversionError` with a stable `code` such as `unknown-format` or `missing-dependency`.

The two outputs treat templates differently. The Word file is a semantic document: headings,
paragraphs, the quote, and a bulleted list, with the tags dropped. The PowerPoint deck is the
slideshow — the same projection as the player, one slide per block plus a cover slide, drawn as
native shapes and text boxes. To go the other way, pass the bytes of a `.docx`, `.pptx`, `.pdf`,
`.xlsx`, `.csv`, or `.html` file as `{ kind: 'bytes', data, filename }` and ask for `'md'`.

## Next steps

- [Architecture](concepts/architecture.md) — how Markdown becomes slides, pages, dashboards, and
  files.
- [Rendering guide](guides/rendering.md) — slideshows, pages, dashboards, and their options in React.
- [Editor guide](guides/editor.md) — embed the full `EditorShell`.
- [Conversion guide](guides/conversion.md) — importing and exporting every supported format.
- [Sample apps](samples/index.md) — complete projects, including a
  [React viewer](samples/react-viewer.md) and a [Node converter](samples/node-converter.md).
