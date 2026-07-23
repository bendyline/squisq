/**
 * `squisq transform` — one-time markdown SOURCE transforms.
 *
 * Applies an ordered list of text transforms from core's
 * `MARKDOWN_SOURCE_TRANSFORMS` registry (unwrap forced line wrapping, wrap
 * prose at a column width, canonical cleanup) to a markdown file. Distinct
 * from the `--transform <style>` flag on `convert`/`video`, which applies a
 * slideshow *style* transform to the parsed doc — this command rewrites the
 * markdown text itself.
 *
 * Output goes to stdout by default (pipe-friendly); `-o <file>` writes a
 * file (guarded by `--overwrite`), `--in-place` rewrites the input.
 * Transforms run in strict mode: if a transform cannot prove its output
 * parses to an equivalent document, the command fails instead of emitting
 * anything.
 */

import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Command, Option } from 'commander';
import {
  DEFAULT_WRAP_WIDTH,
  MARKDOWN_SOURCE_TRANSFORMS,
  applyMarkdownSourceTransform,
} from '@bendyline/squisq/markdown';
import { assertOutputsWritable, writeFileGuarded } from '../util/outputGuard.js';

const VALID_OPS = MARKDOWN_SOURCE_TRANSFORMS.map((t) => t.id);

interface TransformOpts {
  ops: string;
  width: string;
  output?: string;
  inPlace?: boolean;
  overwrite?: boolean;
}

export function registerTransformCommand(program: Command): void {
  program
    .command('transform')
    .description('Apply one-time markdown source transforms (unwrap, wrap, cleanup) to a document')
    .argument('<input>', 'Path to a markdown (.md) file')
    .requiredOption(
      '--ops <list>',
      `Comma-separated transforms, applied in order. Valid: ${VALID_OPS.join(', ')}`,
    )
    .option(
      '--width <n>',
      'Column width for the wrap transform (20–500)',
      String(DEFAULT_WRAP_WIDTH),
    )
    .addOption(
      new Option('-o, --output <file>', 'Write the result to a file (default: stdout)').conflicts(
        'inPlace',
      ),
    )
    .addOption(
      new Option('--in-place', 'Rewrite the input file with the result').conflicts('output'),
    )
    .option('--overwrite', 'Replace an existing --output file (default: refuse and exit non-zero)')
    .action(async (inputPath: string, opts: TransformOpts) => {
      try {
        process.exitCode = await runTransform(inputPath, opts);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exitCode = 1;
      }
    });
}

/** Exit codes: 0 success, 1 transform/output failure, 2 unreadable input. */
export async function runTransform(inputPath: string, opts: TransformOpts): Promise<number> {
  const resolvedInput = resolve(inputPath);

  let source: string;
  try {
    source = await readFile(resolvedInput, { encoding: 'utf-8' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: could not read input: ${message}`);
    return 2;
  }

  const ids = opts.ops
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (ids.length === 0) {
    console.error(`Error: --ops needs at least one transform (valid: ${VALID_OPS.join(', ')})`);
    return 1;
  }
  for (const id of ids) {
    if (!VALID_OPS.includes(id as (typeof VALID_OPS)[number])) {
      console.error(`Error: unknown transform "${id}" (valid: ${VALID_OPS.join(', ')})`);
      return 1;
    }
  }

  if (!/^\d+$/.test(opts.width)) {
    console.error(`Error: --width must be an integer between 20 and 500 (got "${opts.width}")`);
    return 1;
  }
  const width = Number(opts.width);
  if (!Number.isSafeInteger(width) || width < 20 || width > 500) {
    console.error(`Error: --width must be an integer between 20 and 500 (got "${opts.width}")`);
    return 1;
  }

  // Strict mode: a transform that cannot prove structural equivalence throws
  // (caught by the action wrapper → exit 1) rather than emitting anything.
  let result = source;
  const applied: string[] = [];
  for (const id of ids) {
    const step = applyMarkdownSourceTransform(id, result, { width, strict: true });
    result = step.output;
    applied.push(step.changed ? id : `${id} (no changes)`);
  }
  const summary = applied.join(', ');
  const bytes = Buffer.from(result, 'utf-8');

  if (opts.inPlace) {
    // In-place implies overwriting the input; that is the point of the flag.
    await writeFileGuarded(resolvedInput, bytes, true);
    console.error(`✓ ${summary} → ${resolvedInput}`);
  } else if (opts.output) {
    const resolvedOutput = resolve(opts.output);
    await assertOutputsWritable([resolvedOutput], opts.overwrite);
    await mkdir(dirname(resolvedOutput), { recursive: true });
    await writeFileGuarded(resolvedOutput, bytes, opts.overwrite);
    console.error(`✓ ${summary} → ${resolvedOutput}`);
  } else {
    // Machine-readable payload → stdout; human status → stderr.
    process.stdout.write(result);
    console.error(`✓ ${summary}`);
  }
  return 0;
}
