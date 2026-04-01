# @bendyline/squisq-cli

Command-line tool for converting Squisq documents to multiple formats and rendering them to video. Reads Markdown files, ZIP/DBK containers, or folders as input.

Part of the [Squisq](https://github.com/bendyline/squisq) monorepo.

[![npm](https://img.shields.io/npm/v/@bendyline/squisq-cli)](https://www.npmjs.com/package/@bendyline/squisq-cli)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/bendyline/squisq/blob/main/LICENSE)

## Install

```bash
npm install -g @bendyline/squisq-cli
```

## Commands

### `squisq convert`

Convert a Squisq document to DOCX, PPTX, PDF, HTML, EPUB, or DBK (container ZIP):

```bash
squisq convert input.md --formats docx,pptx,pdf
squisq convert project.dbk --output-dir ./out --formats html,docx
squisq convert ./my-folder --formats pdf --theme documentary
squisq convert input.md --theme cinematic --transform magazine --formats pptx
```

| Option         | Description                                            | Default     |
| -------------- | ------------------------------------------------------ | ----------- |
| `--output-dir` | Output directory                                       | current dir |
| `--formats`    | Comma-separated list: docx, pptx, pdf, html, epub, dbk | all         |
| `--theme`      | Squisq theme ID (e.g., documentary, cinematic)         | none        |
| `--transform`  | Transform style (e.g., documentary, magazine)          | none        |

### `squisq video`

Render a Squisq document to MP4 video using Playwright for frame capture and native ffmpeg for encoding:

```bash
squisq video input.md output.mp4
squisq video project.dbk --quality high --fps 30
squisq video ./my-folder --orientation portrait --captions social
```

| Option          | Description               | Default   |
| --------------- | ------------------------- | --------- |
| `--fps`         | Frames per second (1–120) | 30        |
| `--quality`     | draft, normal, or high    | normal    |
| `--orientation` | landscape or portrait     | landscape |
| `--captions`    | off, standard, or social  | off       |
| `--width`       | Override width in pixels  | auto      |
| `--height`      | Override height in pixels | auto      |

**Requires:** [ffmpeg](https://ffmpeg.org/) installed and available on your PATH.

## Programmatic API

Use the CLI as a library from Node.js — no shell-out required:

```ts
import { renderDocToMp4, MemoryContentContainer, readInput } from '@bendyline/squisq-cli/api';

// Load a document from disk
const { doc, container } = await readInput('./my-article.md');

// Render to MP4
const result = await renderDocToMp4(doc, container, {
  outputPath: './output.mp4',
  fps: 30,
  quality: 'high',
  orientation: 'landscape',
  captionStyle: 'social',
  onProgress: (phase, pct) => console.log(`${phase}: ${pct}%`),
});

console.log(`Rendered ${result.frameCount} frames (${result.duration}s)`);
```

### `extractThumbnails`

Extract JPEG thumbnails from the first frame of a rendered video:

```ts
import { extractThumbnails } from '@bendyline/squisq-cli/api';

await extractThumbnails({
  videoPath: './output.mp4',
  outputDir: './thumbs',
  slug: 'my-article',
  sizes: [
    { name: 'og', width: 1200, height: 630, filter: 'scale=1200:630' },
    { name: 'thumb', width: 480, height: 270, filter: 'scale=480:270' },
  ],
});
```

See the full [API Reference](../../docs/API.md#bendylinesquisq-cli) for all types and options.

## Input Formats

The CLI accepts three types of input:

| Input         | Description                                               |
| ------------- | --------------------------------------------------------- |
| `.md` file    | Plain Markdown file                                       |
| `.zip`/`.dbk` | Container archive with document + embedded media          |
| Folder        | Directory with a Markdown file and associated media files |

## Related Packages

| Package                                                                              | Description                                     |
| ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| [@bendyline/squisq](https://www.npmjs.com/package/@bendyline/squisq)                 | Headless core — schemas, templates, markdown    |
| [@bendyline/squisq-formats](https://www.npmjs.com/package/@bendyline/squisq-formats) | DOCX, PDF, HTML import/export (used by convert) |
| [@bendyline/squisq-video](https://www.npmjs.com/package/@bendyline/squisq-video)     | Headless video rendering (used by video)        |
| [@bendyline/squisq-react](https://www.npmjs.com/package/@bendyline/squisq-react)     | React components for rendering docs             |

## License

[MIT](https://github.com/bendyline/squisq/blob/main/LICENSE)
