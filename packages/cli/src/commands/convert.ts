/**
 * convert command
 *
 * Reads a markdown file, ZIP/DBK container, or folder and exports to
 * all supported formats: DOCX, PDF, HTML, and container ZIP (.dbk).
 *
 * Usage:
 *   squisq convert <input> [--output-dir <dir>] [--formats <list>]
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename, extname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { readInput } from '../util/readInput.js';

const ALL_FORMATS = ['docx', 'pdf', 'html', 'dbk'] as const;
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

export function registerConvertCommand(program: Command): void {
  program
    .command('convert')
    .description('Convert a markdown document to DOCX, PDF, HTML, and DBK container formats')
    .argument('<input>', 'Path to .md file, .zip/.dbk container, or folder')
    .option('-o, --output-dir <dir>', 'Output directory (default: same as input)')
    .option(
      '-f, --formats <list>',
      `Comma-separated formats to produce (default: all). Valid: ${ALL_FORMATS.join(', ')}`,
    )
    .action(async (inputPath: string, opts: { outputDir?: string; formats?: string }) => {
      try {
        await runConvert(inputPath, opts);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exitCode = 1;
      }
    });
}

async function runConvert(
  inputPath: string,
  opts: { outputDir?: string; formats?: string },
): Promise<void> {
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

  console.error(`Reading: ${resolvedInput}`);
  const { container, markdownDoc } = await readInput(resolvedInput);

  for (const format of formats) {
    const outPath = join(outputDir, `${baseName}.${format}`);

    switch (format) {
      case 'docx': {
        const { markdownDocToDocx } = await import('@bendyline/squisq-formats/docx');
        const buf = await markdownDocToDocx(markdownDoc);
        await writeFile(outPath, Buffer.from(buf));
        break;
      }

      case 'pdf': {
        const { markdownDocToPdf } = await import('@bendyline/squisq-formats/pdf');
        const buf = await markdownDocToPdf(markdownDoc);
        await writeFile(outPath, Buffer.from(buf));
        break;
      }

      case 'html': {
        const { markdownToDoc } = await import('@bendyline/squisq/doc');
        const { docToHtml, collectImagePaths } = await import('@bendyline/squisq-formats/html');
        const { PLAYER_BUNDLE } = await import('@bendyline/squisq-react/standalone-source');

        const doc = markdownToDoc(markdownDoc);

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
        });
        await writeFile(outPath, html, 'utf-8');
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
