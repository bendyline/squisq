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

Convert a Squisq document to DOCX, PPTX, PDF, HTML, or DBK (container ZIP):

```bash
squisq convert input.md --formats docx,pptx,pdf
squisq convert project.dbk --output-dir ./out --formats html,docx
squisq convert ./my-folder --formats pdf --theme documentary
squisq convert input.md --theme cinematic --transform magazine --formats pptx
```

| Option         | Description                                      | Default     |
| -------------- | ------------------------------------------------ | ----------- |
| `--output-dir` | Output directory                                 | current dir |
| `--formats`    | Comma-separated list: docx, pptx, pdf, html, dbk | all         |
| `--theme`      | Squisq theme ID (e.g., documentary, cinematic)   | none        |
| `--transform`  | Transform style (e.g., documentary, magazine)    | none        |

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
