/**
 * convert command
 *
 * Reads any supported input — a markdown file, a JSON Doc, a `.zip`/`.dbk`
 * container, a folder, or an importable binary (`.docx`/`.pptx`/`.pdf`/
 * `.xlsx`/`.csv`/`.html`) — and exports it to one or more target formats via
 * the shared format registry's `convert()`.
 *
 * Supports optional --theme and --transform flags to apply a squisq theme
 * and/or transform style before exporting.
 *
 * Usage:
 *   squisq convert <input> [--output-dir <dir>] [--formats <list>] [--theme <id>] [--transform <style>]
 *   squisq convert <input> -o <file>          # single output; format inferred from extension
 *   squisq convert <input> --format <id>      # single format to the default output dir
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename, extname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { BUILTIN_FORMAT_IDS, ConversionError } from '@bendyline/squisq-formats';
import type { ConvertSource, FormatId } from '@bendyline/squisq-formats';
import { readInput } from '../util/readInput.js';
import { createCliRegistry } from '../registry.js';
import { convert } from '../api.js';
import { assertValidThemeId, assertValidTransformStyle } from '../util/applyTransformPipeline.js';

/** Every format the registry can export (built-ins + the CLI-only mp4). */
const VALID_FORMATS: readonly FormatId[] = [...BUILTIN_FORMAT_IDS, 'mp4'];

/**
 * Default formats produced by a bare `convert <input>` (no -o / --format /
 * --formats). Deliberately excludes md/xlsx/csv and — crucially — mp4, so a
 * bare convert never spins up Playwright/FFmpeg.
 */
const DEFAULT_FORMATS: readonly FormatId[] = [
  'docx',
  'pptx',
  'pdf',
  'html',
  'htmlzip',
  'epub',
  'dbk',
];

function isValidFormat(id: string): boolean {
  return VALID_FORMATS.includes(id);
}

function parseFormats(value: string): FormatId[] {
  const requested = value.split(',').map((s) => s.trim().toLowerCase());
  const valid: FormatId[] = [];
  for (const r of requested) {
    if (isValidFormat(r)) {
      valid.push(r);
    } else {
      console.warn(`Unknown format "${r}" — skipping. Valid: ${VALID_FORMATS.join(', ')}`);
    }
  }
  if (valid.length === 0) {
    throw new Error(`No valid formats specified. Valid: ${VALID_FORMATS.join(', ')}`);
  }
  return valid;
}

/** Infer a target format id from an explicit output file path's extension. */
function formatFromOutputPath(outputPath: string): FormatId {
  const lower = outputPath.toLowerCase();
  if (lower.endsWith('.html.zip')) return 'htmlzip';
  const ext = extname(lower);
  const def = createCliRegistry().byExtension(ext);
  if (!def) {
    throw new Error(
      `Cannot infer a format from output extension "${ext || '(none)'}". ` +
        `Use --format to specify one. Valid: ${VALID_FORMATS.join(', ')}`,
    );
  }
  return def.id;
}

interface ConvertOpts {
  output?: string;
  outputDir?: string;
  formats?: string;
  format?: string;
  theme?: string;
  transform?: string;
  autoTemplates?: boolean;
}

export function registerConvertCommand(program: Command): void {
  program
    .command('convert')
    .description('Convert a document to DOCX, PPTX, PDF, HTML, EPUB, MP4, and container formats')
    .argument('<input>', 'Path to .md/.docx/.pptx/.pdf/.xlsx/.csv/.html file, .zip/.dbk, or folder')
    .option('-o, --output <file>', 'Single output file (format inferred from its extension)')
    .option(
      '-d, --output-dir <dir>',
      'Output directory for multi-format export (default: same as input)',
    )
    .option(
      '-f, --formats <list>',
      `Comma-separated formats to produce (default: a standard set). Valid: ${VALID_FORMATS.join(', ')}`,
    )
    .option('--format <id>', 'Produce a single format (alias for a one-entry --formats)')
    .option('-t, --theme <id>', 'Squisq theme ID to apply (e.g., documentary, cinematic, bold)')
    .option(
      '--transform <style>',
      'Transform style to apply before export (e.g., documentary, magazine, minimal)',
    )
    .option(
      '--no-auto-templates',
      'Disable content-aware template auto-picking for unannotated headings',
    )
    .action(async (inputPath: string, opts: ConvertOpts) => {
      try {
        await runConvert(inputPath, opts);
      } catch (err: unknown) {
        if (err instanceof ConversionError) {
          console.error(`Error: ${err.message}`);
          if (err.hint) console.error(`  ${err.hint}`);
        } else {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Error: ${message}`);
        }
        process.exitCode = 1;
      }
    });
}

/** Resolve the set of target formats from the mutually-exclusive flags. */
function resolveFormats(opts: ConvertOpts): FormatId[] {
  const hasOutput = Boolean(opts.output);
  const hasFormatSelection = Boolean(opts.formats || opts.format);

  if (hasOutput && hasFormatSelection) {
    throw new Error(
      '--output is a single-file destination and cannot be combined with --formats/--format.',
    );
  }

  if (hasOutput) {
    return [formatFromOutputPath(opts.output!)];
  }
  if (opts.format) {
    if (!isValidFormat(opts.format.toLowerCase())) {
      throw new Error(`Unknown format "${opts.format}". Valid: ${VALID_FORMATS.join(', ')}`);
    }
    return [opts.format.toLowerCase()];
  }
  if (opts.formats) {
    return parseFormats(opts.formats);
  }
  return [...DEFAULT_FORMATS];
}

async function runConvert(inputPath: string, opts: ConvertOpts): Promise<void> {
  const resolvedInput = resolve(inputPath);

  const formats = resolveFormats(opts);

  // Base filename (used for suggested output names in multi-format mode).
  const inputBasename = basename(resolvedInput);
  const inputExt = extname(inputBasename);
  const baseName = inputExt ? inputBasename.slice(0, -inputExt.length) : inputBasename;

  // Validate the transform id up front (the style registry is static). The
  // theme id is validated after the doc is read, so a custom theme inlined in
  // the doc's frontmatter is admitted rather than rejected as "unknown".
  if (opts.transform) {
    await assertValidTransformStyle(opts.transform);
  }

  console.error(`Reading: ${resolvedInput}`);
  const result = await readInput(resolvedInput);

  if (opts.theme) {
    await assertValidThemeId(opts.theme, result);
  }

  // Build the convert() source once: prefer the markdown shape (so auto-
  // templating options apply), else the pre-built Doc.
  const source: ConvertSource = result.markdownDoc
    ? {
        kind: 'markdown',
        markdown: result.markdownDoc,
        container: result.container,
        baseName,
      }
    : { kind: 'doc', doc: result.doc, container: result.container, baseName };

  if (opts.transform) {
    console.error(`  Applying transform: ${opts.transform}`);
  }

  for (const format of formats) {
    const conversion = await convert(source, format, {
      themeId: opts.theme,
      transformStyle: opts.transform,
      autoTemplates: opts.autoTemplates,
      title: baseName,
    });

    for (const warning of conversion.warnings) {
      console.error(`  ⚠ ${warning}`);
    }

    const outPath = opts.output
      ? resolve(opts.output)
      : join(
          opts.outputDir ? resolve(opts.outputDir) : dirname(resolvedInput),
          conversion.suggestedFilename,
        );

    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, Buffer.from(conversion.bytes));
    console.error(`  ✓ ${outPath}`);
  }

  console.error('Done.');
}
