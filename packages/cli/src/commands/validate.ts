/**
 * validate command
 *
 * Structural validation for squisq markdown documents — fast feedback for
 * authors and agents without opening a browser. Reports unknown template
 * names (with did-you-mean), unparsed `{[…]}` annotations, malformed
 * heading attributes, unresolved `connectsTo` targets, duplicate block ids,
 * unparseable data fences, and image references missing from the bundle.
 *
 * Exit code: 0 when clean (or warnings only), 1 when errors are present
 * (or any finding with --strict), 2 when the input could not be read.
 *
 * Usage:
 *   squisq validate <input> [--json] [--strict]
 */

import { existsSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import type { DocDiagnostic } from '@bendyline/squisq/schemas';
import { validateMarkdownDoc } from '@bendyline/squisq/doc';
import { readInput } from '../util/readInput.js';

interface ValidateOpts {
  json?: boolean;
  strict?: boolean;
}

export function registerValidateCommand(program: Command): void {
  program
    .command('validate')
    .description('Validate a squisq markdown document and report structural problems')
    .argument('<input>', 'Path to .md file, .zip/.dbk container, or folder')
    .option('--json', 'Output diagnostics as JSON (for tooling and agents)')
    .option('--strict', 'Exit non-zero on warnings as well as errors')
    .action(async (inputPath: string, opts: ValidateOpts) => {
      try {
        const exitCode = await runValidate(inputPath, opts);
        process.exitCode = exitCode;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exitCode = 2;
      }
    });
}

async function runValidate(inputPath: string, opts: ValidateOpts): Promise<number> {
  const resolvedInput = resolve(inputPath);
  const { container, markdownDoc, doc } = await readInput(resolvedInput);

  if (!markdownDoc) {
    // Doc-JSON input: nothing markdown-level to validate. Surface any
    // diagnostics already recorded on the doc.
    const diagnostics = doc?.diagnostics ?? [];
    return report(diagnostics, opts, 'doc.json input — markdown-level checks skipped');
  }

  // Asset check source: container file list (dbk/zip/folder) or, for a bare
  // .md file, the filesystem relative to the document's folder.
  const entries = await container.listFiles();
  const containerPaths = new Set(entries.map((e) => e.path));
  const isBareMarkdown =
    statSync(resolvedInput).isFile() &&
    !['.zip', '.dbk'].includes(extname(resolvedInput).toLowerCase());
  const baseDir = dirname(resolvedInput);
  const hasAsset = (path: string): boolean => {
    if (containerPaths.has(path) || containerPaths.has(path.replace(/^\.\//, ''))) return true;
    if (isBareMarkdown) return existsSync(join(baseDir, path));
    return false;
  };

  const result = validateMarkdownDoc(markdownDoc, { assets: hasAsset });
  return report(result.diagnostics, opts);
}

function report(diagnostics: DocDiagnostic[], opts: ValidateOpts, note?: string): number {
  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = diagnostics.length - errorCount;

  if (opts.json) {
    // Machine-readable output goes to stdout so it can be piped/parsed;
    // everything human-facing follows the CLI convention of stderr.
    process.stdout.write(`${JSON.stringify({ errorCount, warningCount, diagnostics }, null, 2)}\n`);
  } else {
    if (note) console.error(note);
    for (const d of diagnostics) {
      const location = d.line != null ? `line ${d.line}` : (d.blockId ?? '—');
      console.error(
        `${d.severity === 'error' ? 'ERROR  ' : 'warning'}  ${location}  [${d.code}] ${d.message}`,
      );
    }
    if (diagnostics.length === 0) {
      console.error('✓ No problems found');
    } else {
      console.error(`\n${errorCount} error(s), ${warningCount} warning(s)`);
    }
  }

  if (errorCount > 0) return 1;
  if (opts.strict && warningCount > 0) return 1;
  return 0;
}
