/**
 * image command
 *
 * Renders a squisq document's Dashboard rendition to a PNG image by
 * delegating to the programmatic render API. Needs Playwright Chromium
 * only (no ffmpeg — this is a single-frame capture, not a video encode).
 *
 * Usage:
 *   squisq image <input> [-o output.png] [--resolution fhd|4k|square|…]
 *     [--width <px> --height <px>] [--layout <id|auto>] [--no-title]
 *     [--style basic|card|panel|accent] [--theme <id>] [--transform <style>]
 */

import { mkdir } from 'node:fs/promises';
import { dirname, basename, extname, resolve } from 'node:path';
import type { Command } from 'commander';
import type { Doc } from '@bendyline/squisq/schemas';
import {
  DASHBOARD_AUTO_LAYOUT_ID,
  DASHBOARD_STYLE_IDS,
  listDashboardLayouts,
  resolveDashboardStyleId,
} from '@bendyline/squisq/doc';
import {
  DASHBOARD_RESOLUTIONS,
  DEFAULT_DASHBOARD_RESOLUTION,
  resolveDashboardDimensions,
  type DashboardResolutionId,
} from '@bendyline/squisq-video';
import { readInput } from '../util/readInput.js';
import {
  applyTransformToDoc,
  assertValidThemeId,
  assertValidTransformStyle,
} from '../util/applyTransformPipeline.js';
import { renderDocToDashboardPng } from '../api.js';
import { assertOutputsWritable } from '../util/outputGuard.js';

/** Single source for the command's name so a rename is a one-line edit. */
const IMAGE_COMMAND_NAME = 'image';

const VALID_IMAGE_FORMATS = ['png'] as const;

interface ImageCommandOptions {
  autoTemplates?: boolean;
  output?: string;
  format?: string;
  resolution?: string;
  width?: string;
  height?: string;
  layout?: string;
  /** Cell style variant; unset defers to the doc's own frontmatter. */
  style?: string;
  /** Commander's --title/--no-title pair; defaults true (band shown). */
  title?: boolean;
  overwrite?: boolean;
  theme?: string;
  transform?: string;
}

export function registerImageCommand(program: Command): void {
  const resolutionIds = DASHBOARD_RESOLUTIONS.map((preset) => preset.id).join(', ');
  program
    .command(IMAGE_COMMAND_NAME)
    .description("Render a squisq document's Dashboard to a PNG image")
    .argument('<input>', 'Path to .md/.json file, .zip/.dbk container, or folder')
    .argument('[output]', 'Output .png path (default: <input>.png)')
    .option('-o, --output <path>', 'Output .png path')
    .option('--format <format>', `Output format: ${VALID_IMAGE_FORMATS.join(', ')} (default: png)`)
    .option(
      '--resolution <preset>',
      `Named resolution: ${resolutionIds} (default: ${DEFAULT_DASHBOARD_RESOLUTION})`,
    )
    .option('--width <pixels>', 'Custom image width (requires --height; excludes --resolution)')
    .option('--height <pixels>', 'Custom image height (requires --width; excludes --resolution)')
    .option(
      '--layout <id>',
      `Dashboard layout id, or "${DASHBOARD_AUTO_LAYOUT_ID}" to pick by block count (default)`,
    )
    .option(
      '--style <variant>',
      `Cell style variant: ${DASHBOARD_STYLE_IDS.join(', ')} (default: the document's own setting)`,
    )
    .option('--title', 'Include the document-title band (default)')
    .option('--no-title', 'Hide the document-title band')
    .option(
      '--no-auto-templates',
      'Disable content-aware template auto-picking for unannotated headings',
    )
    .option('-t, --theme <id>', 'Squisq theme ID to apply (e.g., documentary, cinematic, bold)')
    .option(
      '--transform <style>',
      'Transform style to apply before rendering (e.g., documentary, magazine, minimal)',
    )
    .option('--overwrite', 'Replace an existing output file (default: refuse and exit non-zero)')
    .action(async (inputPath: string, outputArg: string | undefined, opts: ImageCommandOptions) => {
      try {
        if (outputArg && opts.output) {
          throw new Error('The positional output and --output cannot be used together.');
        }
        if (outputArg) opts.output = outputArg;
        await runImage(inputPath, opts);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exitCode = 1;
      }
    });
}

async function runImage(inputPath: string, opts: ImageCommandOptions): Promise<void> {
  const resolvedInput = resolve(inputPath);

  // ── Validate everything cheap BEFORE reading the doc or launching a
  //    browser (the video command's established policy). ─────────────
  const requestedFormat = opts.format?.toLowerCase();
  if (
    requestedFormat !== undefined &&
    !VALID_IMAGE_FORMATS.includes(requestedFormat as (typeof VALID_IMAGE_FORMATS)[number])
  ) {
    throw new Error(
      `Invalid format "${requestedFormat}". Valid: ${VALID_IMAGE_FORMATS.join(', ')}`,
    );
  }

  if (opts.output && extname(opts.output).toLowerCase() !== '.png') {
    throw new Error('Output path must end in .png');
  }

  // Preset-vs-custom conflicts, both-or-neither, bounds, and the megapixel
  // cap all fail here with a descriptive RangeError. No even-dimension rule:
  // that constraint is H.264-specific and does not apply to a PNG.
  const width = opts.width === undefined ? undefined : Number(opts.width);
  const height = opts.height === undefined ? undefined : Number(opts.height);
  const dimensions = resolveDashboardDimensions({
    resolution: opts.resolution as DashboardResolutionId | undefined,
    width,
    height,
  });

  if (opts.layout !== undefined && opts.layout.trim().length === 0) {
    throw new Error('The --layout id must be a non-empty string.');
  }

  // The style vocabulary is closed, so an unknown value fails here rather
  // than silently rendering the document's own style.
  const requestedStyle = opts.style === undefined ? undefined : resolveDashboardStyleId(opts.style);
  if (opts.style !== undefined && requestedStyle === undefined) {
    throw new Error(
      `Unknown dashboard style "${opts.style}". Valid: ${DASHBOARD_STYLE_IDS.join(', ')}`,
    );
  }

  // Validate the transform ID up front. The theme id (and the layout id,
  // which may name a doc-defined custom layout) are validated after the doc
  // is read below.
  if (opts.transform) {
    await assertValidTransformStyle(opts.transform);
  }

  // Determine output path
  const inputBasename = basename(resolvedInput);
  const inputExt = extname(inputBasename);
  const baseName = inputExt ? inputBasename.slice(0, -inputExt.length) : inputBasename;
  const outputPath = opts.output
    ? resolve(opts.output)
    : resolve(dirname(resolvedInput), `${baseName}.png`);

  await assertOutputsWritable([outputPath], opts.overwrite);
  await mkdir(dirname(outputPath), { recursive: true });

  // ── Step 1: Read input ──────────────────────────────────────────
  console.error(`Reading: ${resolvedInput}`);
  const result = await readInput(resolvedInput);
  const { container } = result;

  if (opts.theme) {
    await assertValidThemeId(opts.theme, result);
  }

  // ── Step 2: Get or parse Doc ────────────────────────────────────
  let doc: Doc = result.doc;
  if (result.markdownDoc) {
    if (opts.autoTemplates === false) {
      const { markdownToDoc, resolveAudioMapping } = await import('@bendyline/squisq/doc');
      doc = await resolveAudioMapping(
        markdownToDoc(result.markdownDoc, { autoTemplates: false }),
        container,
      );
    }
  } else {
    console.error('Using pre-built Doc JSON');
  }

  // Validate --layout against the layouts this document can actually use:
  // its own custom layouts (frontmatter) plus the built-ins.
  const requestedLayout = opts.layout?.trim().toLowerCase();
  if (requestedLayout && requestedLayout !== DASHBOARD_AUTO_LAYOUT_ID) {
    const available = listDashboardLayouts(doc);
    if (!available.some((layout) => layout.id === requestedLayout)) {
      const known = available.map((layout) => layout.id).join(', ');
      throw new Error(
        `Unknown dashboard layout "${requestedLayout}". Valid: ${DASHBOARD_AUTO_LAYOUT_ID}, ${known}`,
      );
    }
  }

  if (opts.transform) {
    doc = await applyTransformToDoc(doc, opts.transform, opts.theme);
    console.error(`  Applied transform: ${opts.transform}`);
  }
  if (opts.theme) {
    doc = { ...doc, themeId: opts.theme };
  }

  console.error(
    `Rendering dashboard PNG: ${dimensions.width}×${dimensions.height}, layout: ${requestedLayout ?? DASHBOARD_AUTO_LAYOUT_ID}, style: ${requestedStyle ?? 'document'}, title: ${opts.title === false ? 'off' : 'on'}`,
  );

  // ── Step 3: Render via programmatic API ─────────────────────────
  const rendered = await renderDocToDashboardPng(doc, container, {
    outputPath,
    ...(opts.resolution !== undefined
      ? { resolution: opts.resolution as DashboardResolutionId }
      : width !== undefined && height !== undefined
        ? { width, height }
        : {}),
    layout: requestedLayout,
    style: requestedStyle,
    title: opts.title,
    documentTitle: baseName,
    onProgress: (phase: string, percent: number) => writeProgress(phase, percent, 100),
  });

  clearProgress();
  console.error(`  ✓ ${rendered.outputPath} (${rendered.width}×${rendered.height})`);
  console.error('Done.');
}

// ── Progress helpers ──────────────────────────────────────────────

const BAR_WIDTH = 30;

function writeProgress(label: string, current: number, total: number): void {
  const pct = Math.min(100, Math.round((current / total) * 100));
  const filled = Math.round((pct / 100) * BAR_WIDTH);
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
  process.stderr.write(`\r  ${label}: ${bar} ${pct}%  `);
}

function clearProgress(): void {
  process.stderr.write('\r' + ' '.repeat(80) + '\r');
}
