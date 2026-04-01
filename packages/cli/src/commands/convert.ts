/**
 * convert command
 *
 * Reads a markdown file, ZIP/DBK container, or folder and exports to
 * all supported formats: DOCX, PPTX, PDF, HTML, and container ZIP (.dbk).
 *
 * Supports optional --theme and --transform flags to apply a squisq theme
 * and/or transform style before exporting.
 *
 * Usage:
 *   squisq convert <input> [--output-dir <dir>] [--formats <list>] [--theme <id>] [--transform <style>]
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename, extname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { readInput } from '../util/readInput.js';

const ALL_FORMATS = ['docx', 'pptx', 'pdf', 'html', 'epub', 'dbk'] as const;
type Format = (typeof ALL_FORMATS)[number];

function parseFormats(value: string): Format[] {
  const requested = value.split(',').map((s) => s.trim().toLowerCase());
  const valid: Format[] = [];
  for (const r of requested) {
    if (ALL_FORMATS.includes(r as Format)) {
      valid.push(r as Format);
    } else {
      console.warn(`Unknown format "${r}" — skipping. Valid: ${ALL_FORMATS.join(', ')}`);
    }
  }
  if (valid.length === 0) {
    throw new Error(`No valid formats specified. Valid: ${ALL_FORMATS.join(', ')}`);
  }
  return valid;
}

interface ConvertOpts {
  outputDir?: string;
  formats?: string;
  theme?: string;
  transform?: string;
}

export function registerConvertCommand(program: Command): void {
  program
    .command('convert')
    .description('Convert a markdown document to DOCX, PPTX, PDF, HTML, and DBK container formats')
    .argument('<input>', 'Path to .md file, .zip/.dbk container, or folder')
    .option('-o, --output-dir <dir>', 'Output directory (default: same as input)')
    .option(
      '-f, --formats <list>',
      `Comma-separated formats to produce (default: all). Valid: ${ALL_FORMATS.join(', ')}`,
    )
    .option('-t, --theme <id>', 'Squisq theme ID to apply (e.g., documentary, cinematic, bold)')
    .option(
      '--transform <style>',
      'Transform style to apply before export (e.g., documentary, magazine, minimal)',
    )
    .action(async (inputPath: string, opts: ConvertOpts) => {
      try {
        await runConvert(inputPath, opts);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exitCode = 1;
      }
    });
}

async function runConvert(inputPath: string, opts: ConvertOpts): Promise<void> {
  const resolvedInput = resolve(inputPath);

  // Determine which formats to produce
  const formats: Format[] = opts.formats ? parseFormats(opts.formats) : [...ALL_FORMATS];

  // Determine output directory and base filename
  const outputDir = opts.outputDir ? resolve(opts.outputDir) : dirname(resolvedInput);
  const inputBasename = basename(resolvedInput);
  const inputExt = extname(inputBasename);
  const baseName = inputExt ? inputBasename.slice(0, -inputExt.length) : inputBasename;

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  // Validate theme and transform IDs
  if (opts.theme) {
    const { getAvailableThemes } = await import('@bendyline/squisq/schemas');
    const themes = getAvailableThemes();
    if (!themes.includes(opts.theme)) {
      throw new Error(`Unknown theme "${opts.theme}". Available: ${themes.join(', ')}`);
    }
  }

  if (opts.transform) {
    const { getTransformStyleIds } = await import('@bendyline/squisq/transform');
    const styles = getTransformStyleIds();
    if (!styles.includes(opts.transform)) {
      throw new Error(
        `Unknown transform style "${opts.transform}". Available: ${styles.join(', ')}`,
      );
    }
  }

  console.error(`Reading: ${resolvedInput}`);
  const result = await readInput(resolvedInput);
  const { container } = result;

  if (!result.markdownDoc) {
    throw new Error(
      'Convert command requires a markdown document. JSON Doc input is not supported for convert — use the video command instead.',
    );
  }

  // Apply transform if requested
  let exportMarkdownDoc = result.markdownDoc;
  if (opts.transform) {
    exportMarkdownDoc = await applyTransformToMarkdown(
      result.markdownDoc,
      container,
      opts.transform,
      opts.theme,
    );
    console.error(`  Applied transform: ${opts.transform}`);
  }

  const themeId = opts.theme;

  for (const format of formats) {
    const outPath = join(outputDir, `${baseName}.${format}`);

    switch (format) {
      case 'docx': {
        const { markdownDocToDocx } = await import('@bendyline/squisq-formats/docx');
        const buf = await markdownDocToDocx(exportMarkdownDoc, { themeId });
        await writeFile(outPath, Buffer.from(buf));
        break;
      }

      case 'pptx': {
        const { markdownDocToPptx } = await import('@bendyline/squisq-formats/pptx');
        // Collect images from container for PPTX embedding
        const images = await collectContainerImages(container);
        const buf = await markdownDocToPptx(exportMarkdownDoc, { themeId, images });
        await writeFile(outPath, Buffer.from(buf));
        break;
      }

      case 'pdf': {
        const { markdownDocToPdf } = await import('@bendyline/squisq-formats/pdf');
        const buf = await markdownDocToPdf(exportMarkdownDoc, { themeId });
        await writeFile(outPath, Buffer.from(buf));
        break;
      }

      case 'html': {
        const { markdownToDoc } = await import('@bendyline/squisq/doc');
        const { docToHtml, collectImagePaths } = await import('@bendyline/squisq-formats/html');
        const { PLAYER_BUNDLE } = await import('@bendyline/squisq-react/standalone-source');

        const doc = markdownToDoc(exportMarkdownDoc);

        // Gather images referenced by the doc from the container
        const imagePaths = collectImagePaths(doc);
        const images = new Map<string, ArrayBuffer>();
        for (const imgPath of imagePaths) {
          const data = await container.readFile(imgPath);
          if (data) {
            images.set(imgPath, data);
          }
        }

        const html = docToHtml(doc, {
          playerScript: PLAYER_BUNDLE,
          images,
          title: baseName,
          mode: 'static',
          themeId,
        });
        await writeFile(outPath, html, 'utf-8');
        break;
      }

      case 'epub': {
        const { markdownDocToEpub } = await import('@bendyline/squisq-formats/epub');
        const images = await collectContainerImages(container);

        // Collect audio narration from container if Doc has audio segments
        const epubAudio = new Map<string, ArrayBuffer>();
        const audioSegments = result.doc?.audio?.segments;
        if (audioSegments?.length) {
          for (const seg of audioSegments) {
            const data = await container.readFile(seg.src);
            if (data) epubAudio.set(seg.src, data);
          }
        }

        const hasNarration = epubAudio.size > 0;
        const buf = await markdownDocToEpub(exportMarkdownDoc, {
          title: baseName,
          themeId,
          images,
          audio: hasNarration ? epubAudio : undefined,
          audioSegments: hasNarration ? audioSegments : undefined,
          totalDuration: hasNarration ? result.doc?.duration : undefined,
        });
        await writeFile(outPath, Buffer.from(buf));
        break;
      }

      case 'dbk': {
        const { containerToZip } = await import('@bendyline/squisq-formats/container');
        const blob = await containerToZip(container);
        const buf = await blob.arrayBuffer();
        await writeFile(outPath, Buffer.from(buf));
        break;
      }
    }

    console.error(`  ✓ ${outPath}`);
  }

  console.error('Done.');
}

// ============================================
// Transform Pipeline
// ============================================

/**
 * Apply a transform style to a MarkdownDocument.
 * Pipeline: MarkdownDocument → Doc → applyTransform → docToMarkdown → MarkdownDocument
 */
async function applyTransformToMarkdown(
  markdownDoc: MarkdownDocument,
  container: ContentContainer,
  transformStyle: string,
  themeId?: string,
): Promise<MarkdownDocument> {
  const { markdownToDoc, docToMarkdown } = await import('@bendyline/squisq/doc');
  const { applyTransform, extractDocImages } = await import('@bendyline/squisq/transform');

  const doc = markdownToDoc(markdownDoc);

  // Extract image metadata from the doc for transform interleaving
  const images = extractDocImages(doc.blocks);

  const result = applyTransform(doc, transformStyle, {
    themeId,
    images,
  });

  return docToMarkdown(result.doc);
}

/**
 * Collect all image files from a container as a Map<path, ArrayBuffer>.
 */
async function collectContainerImages(
  container: ContentContainer,
): Promise<Map<string, ArrayBuffer>> {
  const images = new Map<string, ArrayBuffer>();
  const files = await container.listFiles();
  for (const file of files) {
    if (/\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)$/i.test(file.path)) {
      const data = await container.readFile(file.path);
      if (data) {
        images.set(file.path, data);
      }
    }
  }
  return images;
}
