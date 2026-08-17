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
 *   squisq convert <input> --formats <id>     # single format to the default output dir
 */

import { mkdir } from 'node:fs/promises';
import { dirname, basename, extname, join, resolve } from 'node:path';
import { Option, type Command } from 'commander';
import { BUILTIN_FORMAT_IDS, ConversionError } from '@bendyline/squisq-formats';
import type { ConvertSource, FormatId } from '@bendyline/squisq-formats';
import { readInput } from '../util/readInput.js';
import { createCliRegistry } from '../registry.js';
import { convert } from '../api.js';
import { assertValidThemeId, assertValidTransformStyle } from '../util/applyTransformPipeline.js';
import { assertOutputsWritable, writeFileGuarded } from '../util/outputGuard.js';
import { suggestId } from '../util/suggestId.js';

/** Every format the registry can export (built-ins + CLI rendered media). */
const VALID_FORMATS: readonly FormatId[] = [...BUILTIN_FORMAT_IDS, 'mp4', 'gif', 'png'];

/**
 * Default formats produced by a bare `convert <input>` (no -o / --formats).
 * Deliberately excludes md/xlsx/csv and — crucially — mp4/gif/png, so a
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

/**
 * Parse `--formats`, rejecting any unknown id.
 *
 * An unknown id is a hard error, not a warning. Warn-and-continue meant
 * `squisq convert doc.md -f docx,pfd` produced only the DOCX and still exited
 * 0 — in CI the silently-missing PDF looks exactly like a successful run.
 */
function parseFormats(value: string): FormatId[] {
  const requested = value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);

  if (requested.length === 0) {
    throw new Error(`No formats specified. Valid: ${VALID_FORMATS.join(', ')}`);
  }

  const unknown = requested.filter((r) => !isValidFormat(r));
  if (unknown.length > 0) {
    const hints = unknown
      .map((id) => {
        const suggestion = suggestId(id, VALID_FORMATS);
        return suggestion ? `"${id}" (did you mean "${suggestion}"?)` : `"${id}"`;
      })
      .join(', ');
    throw new Error(
      `Unknown format${unknown.length > 1 ? 's' : ''}: ${hints}. ` +
        `Valid: ${VALID_FORMATS.join(', ')}`,
    );
  }

  const duplicates = [...new Set(requested.filter((id, index) => requested.indexOf(id) !== index))];
  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate format${duplicates.length > 1 ? 's' : ''}: ${duplicates.map((id) => `"${id}"`).join(', ')}. ` +
        'Each format may only be requested once.',
    );
  }

  return requested as FormatId[];
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
        `Use --formats to specify one. Valid: ${VALID_FORMATS.join(', ')}`,
    );
  }
  return def.id;
}

interface ConvertOpts {
  output?: string;
  outputDir?: string;
  formats?: string;
  /** Replace existing output files instead of refusing to clobber them. */
  overwrite?: boolean;
  theme?: string;
  transform?: string;
  autoTemplates?: boolean;
  /** Commander `--no-infer-theme` negation: defaults true, false when passed. */
  inferTheme?: boolean;
  /** Commander `--no-infer-layouts` negation: defaults true, false when passed. */
  inferLayouts?: boolean;
  /** Explicit rendered-media animation preference; undefined uses format defaults. */
  animations?: boolean;
}

export function registerConvertCommand(program: Command): void {
  program
    .command('convert')
    .description(
      'Convert a document to DOCX, PPTX, PDF, HTML, EPUB, MP4, animated GIF, dashboard PNG, and container formats',
    )
    .argument('<input>', 'Path to .md/.docx/.pptx/.pdf/.xlsx/.csv/.html file, .zip/.dbk, or folder')
    .addOption(
      new Option(
        '-o, --output <file>',
        'Single output file (format inferred from its extension)',
      ).conflicts(['outputDir', 'formats']),
    )
    .addOption(
      new Option(
        '-d, --output-dir <dir>',
        'Output directory for multi-format export (default: same as input)',
      ).conflicts('output'),
    )
    .addOption(
      new Option(
        '-f, --formats <list>',
        `Comma-separated formats to produce (default: a standard set). Valid: ${VALID_FORMATS.join(', ')}`,
      ).conflicts('output'),
    )
    .option('--overwrite', 'Replace existing output files (default: refuse and exit non-zero)')
    .option('-t, --theme <id>', 'Squisq theme ID to apply (e.g., documentary, cinematic, bold)')
    .option(
      '--transform <style>',
      'Transform style to apply before export (e.g., documentary, magazine, minimal)',
    )
    .option(
      '--no-auto-templates',
      'Disable content-aware template auto-picking for unannotated headings',
    )
    .option(
      '--no-infer-theme',
      'Do not infer a Squisq theme from an office input file (PPTX theme colors/fonts)',
    )
    .option('--no-infer-layouts', 'Do not derive custom layout templates from PPTX slide layouts')
    .option('--animations', 'Enable slide animations/transitions in rendered media')
    .option('--no-animations', 'Disable slide animations/transitions in rendered media')
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
  const hasFormatSelection = Boolean(opts.formats);

  if (hasOutput && hasFormatSelection) {
    throw new Error('--output is a single-file destination and cannot be combined with --formats.');
  }

  if (hasOutput) {
    return [formatFromOutputPath(opts.output!)];
  }
  if (opts.formats) {
    return parseFormats(opts.formats);
  }
  return [...DEFAULT_FORMATS];
}

/**
 * Predict where a format will be written, mirroring how `convert()` derives
 * `suggestedFilename` (`<baseName>.<first extension of the target format>`).
 *
 * Used only for the pre-flight overwrite check, so a colliding output is
 * reported before any conversion work happens. The write itself still uses the
 * real `suggestedFilename` plus an exclusive-create flag, so this staying in
 * sync is a UX concern, not a correctness one.
 */
function predictOutputPath(
  format: FormatId,
  opts: ConvertOpts,
  resolvedInput: string,
  baseName: string,
): string {
  if (opts.output) return resolve(opts.output);
  const def = createCliRegistry().get(format);
  const ext = def?.extensions[0]?.replace(/^\.+/, '') ?? format;
  return join(
    opts.outputDir ? resolve(opts.outputDir) : dirname(resolvedInput),
    `${baseName}.${ext}`,
  );
}

async function runConvert(inputPath: string, opts: ConvertOpts): Promise<void> {
  const resolvedInput = resolve(inputPath);

  const formats = resolveFormats(opts);

  // Base filename (used for suggested output names in multi-format mode).
  const inputBasename = basename(resolvedInput);
  const inputExt = extname(inputBasename);
  const baseName = inputExt ? inputBasename.slice(0, -inputExt.length) : inputBasename;

  // Refuse to clobber before doing any work: converting seven formats and then
  // failing on the last one would already have destroyed the first six.
  await assertOutputsWritable(
    formats.map((format) => predictOutputPath(format, opts, resolvedInput, baseName)),
    opts.overwrite,
  );

  // Validate the transform id up front (the style registry is static). The
  // theme id is validated after the doc is read, so a custom theme inlined in
  // the doc's frontmatter is admitted rather than rejected as "unknown".
  if (opts.transform) {
    await assertValidTransformStyle(opts.transform);
  }

  console.error(`Reading: ${resolvedInput}`);
  const result = await readInput(resolvedInput, {
    inferTheme: opts.inferTheme,
    inferLayouts: opts.inferLayouts,
  });

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
    const formatOptions =
      (format === 'mp4' || format === 'gif') && opts.animations !== undefined
        ? { [format]: { animationsEnabled: opts.animations } }
        : undefined;
    const conversion = await convert(source, format, {
      themeId: opts.theme,
      transformStyle: opts.transform,
      autoTemplates: opts.autoTemplates,
      title: baseName,
      formatOptions,
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
    await writeFileGuarded(outPath, conversion.bytes, opts.overwrite);
    console.error(`  ✓ ${outPath}`);
  }

  console.error('Done.');
}
