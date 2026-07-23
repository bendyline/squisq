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

import { resolve } from 'node:path';
import type { Command } from 'commander';
import type { DocDiagnostic } from '@bendyline/squisq/schemas';
import { validateMarkdownDoc } from '@bendyline/squisq/doc';
import { DocInputValidationError, readInput } from '../util/readInput.js';

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
        if (err instanceof DocInputValidationError) {
          process.exitCode = report(err.diagnostics, opts);
          return;
        }
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
    // Runtime schema validation already ran at the shared input boundary.
    // Surface any document-authored diagnostics that remain.
    const diagnostics = doc.diagnostics ?? [];
    return report(diagnostics, opts, 'doc.json input — canonical schema valid');
  }

  // Every input form now carries its confined assets in the container,
  // including bare markdown. Never probe authored paths directly here: doing
  // so could accidentally bless a `../outside.png` traversal as a valid asset.
  const entries = await container.listFiles();
  const containerPaths = new Set(entries.map((e) => e.path));
  const hasAsset = (path: string): boolean => {
    return containerPaths.has(path) || containerPaths.has(path.replace(/^\.\//, ''));
  };

  const result = validateMarkdownDoc(markdownDoc, { assets: hasAsset });
  return report(result.diagnostics, opts);
}

/** Fixed-width, severity-aware line label. */
function severityLabel(severity: DocDiagnostic['severity']): string {
  switch (severity) {
    case 'error':
      return 'ERROR  ';
    case 'warning':
      return 'warning';
    case 'info':
      return 'ℹ info ';
  }
}

function report(diagnostics: DocDiagnostic[], opts: ValidateOpts, note?: string): number {
  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;
  const infoCount = diagnostics.filter((d) => d.severity === 'info').length;

  if (opts.json) {
    // Machine-readable output goes to stdout so it can be piped/parsed;
    // everything human-facing follows the CLI convention of stderr.
    process.stdout.write(
      `${JSON.stringify({ errorCount, warningCount, infoCount, diagnostics }, null, 2)}\n`,
    );
  } else {
    if (note) console.error(note);
    for (const d of diagnostics) {
      const location = d.line != null ? `line ${d.line}` : (d.blockId ?? '—');
      console.error(`${severityLabel(d.severity)}  ${location}  [${d.code}] ${d.message}`);
    }
    if (diagnostics.length === 0) {
      console.error('✓ No problems found');
    } else {
      console.error(`\n${errorCount} error(s), ${warningCount} warning(s), ${infoCount} info`);
    }
  }

  // Exit status is driven by errors only; --strict additionally fails on
  // warnings. Info diagnostics never affect the exit code.
  if (errorCount > 0) return 1;
  if (opts.strict && warningCount > 0) return 1;
  return 0;
}
