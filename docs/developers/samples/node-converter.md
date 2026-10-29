---
title: Node converter
description: A Node script that converts every Markdown file in a folder to Word, PowerPoint, PDF, HTML, or EPUB with convert().
---

# Node converter

Point this script at a folder and name the formats you want. It converts every `.md` file in the folder and writes the results beside them: `notes/harbor-survey.md` becomes `notes/harbor-survey.docx`, `.pptx`, and so on. It embeds the local images each document references, prints any warnings the converters report, and exits with an error code when a conversion fails.

What it demonstrates:

- `prepareConversion` from `@bendyline/squisq-formats/registry`: parse a document once, then export it to as many formats as you like.
- A `MemoryContentContainer` holding the document and its images, so exporters can embed them.
- Handling `ConversionError` by its `code`.
- `resolvePlayerScript`, which the HTML format needs.

## Files

```text
folder-converter/
├── package.json
├── tsconfig.json
├── convert-folder.ts
└── notes/
    ├── harbor-survey.md
    └── launch-brief.md
```

**`package.json`**

```json
{
  "name": "squisq-folder-converter",
  "private": true,
  "type": "module",
  "scripts": {
    "convert": "tsx convert-folder.ts",
    "typecheck": "tsc --noEmit"
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
    "tsx": "4.23.15",
    "typescript": "5.9.3"
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
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["convert-folder.ts"]
}
```

**`convert-folder.ts`**

```ts
/**
 * Convert every Markdown file in a folder to the formats you name.
 *
 *   npx tsx convert-folder.ts <folder> [formats]
 *
 * `formats` is a comma-separated list of registry ids (default: docx,pdf).
 * Each output is written beside its source: notes/brief.md → notes/brief.docx.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { findNodesByType, parseMarkdown, type MarkdownImage } from '@bendyline/squisq/markdown';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import {
  ConversionError,
  prepareConversion,
  type PreparedConversion,
} from '@bendyline/squisq-formats/registry';

const [folderArg, formatsArg = 'docx,pdf'] = process.argv.slice(2);
if (!folderArg) {
  console.error('Usage: npx tsx convert-folder.ts <folder> [docx,pptx,pdf,html,epub]');
  process.exit(2);
}
const folder = resolve(folderArg);
const formats = formatsArg
  .split(',')
  .map((id) => id.trim().toLowerCase())
  .filter(Boolean);

// HTML export embeds the standalone player; load it only if HTML is asked for.
const resolvePlayerScript = () =>
  import('@bendyline/squisq-react/standalone-source').then((m) => m.PLAYER_BUNDLE);

/**
 * A container holding the document plus every local image it references, so
 * DOCX, PPTX, PDF, HTML, and EPUB can embed them. Remote and data: URLs are
 * left to the exporters; paths that climb out of the folder are skipped.
 */
async function containerFor(mdPath: string, markdown: string): Promise<MemoryContentContainer> {
  const container = new MemoryContentContainer();
  await container.writeDocument(markdown, basename(mdPath));
  const dir = dirname(mdPath);
  for (const image of findNodesByType<MarkdownImage>(parseMarkdown(markdown), 'image')) {
    const src = decodeURI(image.url.split(/[?#]/)[0]);
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(src)) continue;
    const file = resolve(dir, src);
    if (relative(dir, file).startsWith('..')) continue;
    try {
      await container.writeFile(src, await readFile(file));
    } catch {
      console.warn(`  ! image not found: ${src}`);
    }
  }
  return container;
}

function describe(err: unknown): string {
  if (err instanceof ConversionError) {
    return `${err.code}: ${err.message}${err.hint ? ` (${err.hint})` : ''}`;
  }
  return err instanceof Error ? err.message : String(err);
}

const files = (await readdir(folder)).filter((name) => extname(name).toLowerCase() === '.md');
if (files.length === 0) {
  console.log(`No .md files in ${folder}`);
  process.exit(0);
}

let failures = 0;
for (const name of files.sort()) {
  const mdPath = join(folder, name);
  const markdown = await readFile(mdPath, 'utf8');
  console.log(name);

  let prepared: PreparedConversion;
  try {
    // Parse once; every target format exports from the same snapshot.
    prepared = await prepareConversion(
      {
        kind: 'markdown',
        markdown,
        container: await containerFor(mdPath, markdown),
        baseName: basename(name, extname(name)),
      },
      { resolvePlayerScript },
    );
  } catch (err: unknown) {
    console.error(`  ✗ could not read: ${describe(err)}`);
    failures++;
    continue;
  }

  for (const format of formats) {
    try {
      const result = await prepared.convert(format);
      await writeFile(join(folder, result.suggestedFilename), result.bytes);
      const kb = (result.bytes.byteLength / 1024).toFixed(1);
      console.log(`  ✓ ${result.suggestedFilename} (${kb} KB)`);
      for (const warning of result.warnings) console.log(`    ⚠ ${warning}`);
    } catch (err: unknown) {
      console.error(`  ✗ ${format}: ${describe(err)}`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} conversion(s) failed.`);
  process.exitCode = 1;
}
```

Two documents to convert. Any Markdown works; these use a few block tags so the slides have some variety.

**`notes/harbor-survey.md`**

```markdown
---
title: Harbor Survey, October
---

# Harbor Survey, October

The autumn survey covered the north basin and both breakwaters over three days of calm water.

## Depth at the fuel dock {[statHighlight]}

**4.2 m** at mean low water, down 0.3 m since the spring survey.

## Findings

- Silt is building along the inner face of the east breakwater.
- Mooring buoys 14 through 19 need new chain.
- The tide gauge drifted 6 cm and was recalibrated on site.

## Next steps

| Task                    | Owner   | Due        |
| ----------------------- | ------- | ---------- |
| Dredging quote          | Marisol | 2026-11-15 |
| Replace buoy chain      | Dev     | 2026-11-30 |
| Re-survey the east face | Marisol | 2027-04-01 |
```

**`notes/launch-brief.md`**

```markdown
---
title: Trailhead Launch Brief
---

# Trailhead Launch Brief

Trailhead is the offline trail-map app for weekend hikers. It ships to the public on November 18.

## Why now {[quote]}

> People want maps that work where the signal ends.
> — Field interview, Mount Pilchuck trailhead

## What ships

1. Offline topo maps for 40 state parks
2. Turn-by-turn trail directions without a signal
3. A shared trip log for hiking groups

## Launch checklist

- [x] App store listings approved
- [x] Press kit sent to six outdoor outlets
- [ ] Ranger station posters printed
```

## Run it

```bash
npm install
npx tsx convert-folder.ts notes docx,pptx,pdf,html,epub
```

```text
harbor-survey.md
  ✓ harbor-survey.docx (13.8 KB)
  ✓ harbor-survey.pptx (39.4 KB)
  ✓ harbor-survey.pdf (5.0 KB)
  ✓ harbor-survey.html (1999.2 KB)
  ✓ harbor-survey.epub (4.2 KB)
launch-brief.md
  ✓ launch-brief.docx (14.5 KB)
  ✓ launch-brief.pptx (30.1 KB)
  ✓ launch-brief.pdf (4.6 KB)
  ✓ launch-brief.html (1996.5 KB)
  ✓ launch-brief.epub (4.1 KB)
```

Sizes vary a little between releases. Leave off the format list to get `docx,pdf`.

A format the registry doesn't know fails on its own, without stopping the rest, and the script exits with status 1:

```bash
npx tsx convert-folder.ts notes docx,odt
```

```text
harbor-survey.md
  ✓ harbor-survey.docx (13.8 KB)
  ✗ odt: unknown-format: Unknown target format "odt".
launch-brief.md
  ✓ launch-brief.docx (14.5 KB)
  ✗ odt: unknown-format: Unknown target format "odt".

2 conversion(s) failed.
```

## How it works

### Prepare once, export many

`convert(source, format, options)` is the one-call form: it parses the source, applies any options, and exports. `prepareConversion(source, options)` does the parsing and preparation once and returns an object whose `convert(format)` exports that snapshot, which is what you want when one document becomes several files. Both return the same result:

| Field               | Contents                                                             |
| ------------------- | -------------------------------------------------------------------- |
| `bytes`             | The file, as a `Uint8Array`                                          |
| `mimeType`          | Its MIME type                                                        |
| `suggestedFilename` | `baseName` plus the format's extension, such as `harbor-survey.docx` |
| `warnings`          | Things the format could not carry over; often empty                  |

The source here is `{ kind: 'markdown', markdown, container, baseName }`. `convert()` also takes `{ kind: 'bytes', data, filename }` to import a DOCX, PPTX, XLSX, PDF, CSV, or HTML file, and `{ kind: 'doc', doc }` for a `Doc` you built in code.

### The formats

The built-in format ids are `md`, `docx`, `pdf`, `pptx`, `xlsx`, `csv`, `html`, `htmlzip`, `epub`, and `dbk`. The five this page uses:

| Id     | What you get                                                                                        |
| ------ | --------------------------------------------------------------------------------------------------- |
| `docx` | A Word document: headings, lists, tables, images, and footnotes as Word footnotes                   |
| `pptx` | A PowerPoint deck of the slideshow rendition, one slide per block, in the document's theme          |
| `pdf`  | A paginated PDF                                                                                     |
| `html` | One self-contained web page with the player and images inlined; it opens in the scrolling page view |
| `epub` | An EPUB 3 e-book with a table of contents                                                           |

The HTML files are about 2 MB because each carries the standalone player. `resolvePlayerScript` supplies it; without that option the `html` and `htmlzip` formats fail with `missing-dependency`.

### Images

`convert()` reads images from the source's container. A Markdown source passed without one gets a container holding only the document, so the exporters have no image files to embed. `containerFor` puts the document into a new `MemoryContentContainer` and copies in each local image it references, keyed by the path as written in the Markdown, so `![Map](images/basin.png)` is found at `images/basin.png`. It skips remote URLs and paths that lead outside the folder.

### Errors

Every failure from `convert()` or `prepareConversion()` is a `ConversionError` with a stable `code`, an optional `format`, and an optional `hint`:

| `code`               | Meaning                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `unknown-format`     | No format with that id is registered                                 |
| `unsupported-input`  | The source format can't be imported                                  |
| `unsupported-output` | The target format can't be exported                                  |
| `invalid-input`      | The source couldn't be read or is over a safety limit                |
| `missing-dependency` | A required option is missing, such as `resolvePlayerScript` for HTML |
| `conversion-failed`  | The exporter itself failed; the original error is on `cause`         |

Branch on `code`, not on the message. Warnings are not errors: a successful conversion can still report, for example, that a format dropped something it has no way to show.

## Ideas for extending it

- **A theme.** Pass `themeId: 'documentary'` (or any [built-in theme](../../guide/themes.md)) in the options to style every output. Without it, each document uses the theme its frontmatter names.
- **Slides from prose.** Pass `transformStyle: 'documentary'` to restructure each document into a slideshow before export. The [transform reference](../../API.md#subpath-transform) lists the six built-in styles.
- **Per-format options.** `formatOptions` carries settings for one format, such as `formatOptions: { pptx: { includeCoverSlide: false } }`.
- **An output folder.** Write to `join(outDir, result.suggestedFilename)` instead of beside the source.
- **Tables to spreadsheets.** Add `xlsx` or `csv` for documents whose content is mostly tables.
- **Everything the CLI reads.** `readInput(path)` from `@bendyline/squisq-cli/api` loads a Markdown file with its images and narration, a folder, a ZIP, or an office file, the way the `squisq` command does. See [CLI and API](../guides/cli-api.md).
