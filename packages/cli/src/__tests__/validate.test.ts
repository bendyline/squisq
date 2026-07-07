/**
 * validate command integration tests
 *
 * Exercises `squisq validate` against clean documents, documents with
 * warnings (unknown templates, missing assets), and documents with errors
 * (unparseable data fences), checking output and exit codes.
 */

import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);

const CLI_PATH = join(import.meta.dirname, '..', '..', 'dist', 'index.js');

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Run the CLI; unlike exec, non-zero exit codes resolve instead of throwing. */
async function runCli(...args: string[]): Promise<CliResult> {
  try {
    const { stdout, stderr } = await exec('node', [CLI_PATH, ...args], { timeout: 30_000 });
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.code ?? 1 };
  }
}

describe('validate command', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `squisq-validate-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function writeDoc(content: string): Promise<string> {
    const mdPath = join(tempDir, 'doc.md');
    await writeFile(mdPath, content, 'utf-8');
    return mdPath;
  }

  it('exits 0 and reports no problems for a clean document', async () => {
    const mdPath = await writeDoc('# Title\n\nBody.\n\n## Section {[quote]}\n\nA quote.\n');
    const result = await runCli('validate', mdPath);
    expect(result.exitCode).to.equal(0);
    expect(result.stderr).to.contain('No problems found');
  });

  it('reports unknown templates with a suggestion and exits 0 (warning only)', async () => {
    const mdPath = await writeDoc('## Gallery {[photGrid]}\n');
    const result = await runCli('validate', mdPath);
    expect(result.exitCode).to.equal(0);
    expect(result.stderr).to.contain('unknown-template');
    expect(result.stderr).to.contain('photoGrid');
  });

  it('--strict exits 1 on warnings', async () => {
    const mdPath = await writeDoc('## Gallery {[photGrid]}\n');
    const result = await runCli('validate', mdPath, '--strict');
    expect(result.exitCode).to.equal(1);
  });

  it('exits 1 on errors (bad data fence)', async () => {
    const mdPath = await writeDoc('## T {[dataTable]}\n\n```json data\nnot json\n```\n');
    const result = await runCli('validate', mdPath);
    expect(result.exitCode).to.equal(1);
    expect(result.stderr).to.contain('data-fence-parse');
  });

  it('flags images missing next to a bare markdown file', async () => {
    const mdPath = await writeDoc('## X\n\n![hero](images/hero.jpg)\n');
    const result = await runCli('validate', mdPath);
    expect(result.stderr).to.contain('missing-asset');

    // Create the asset and re-validate: clean.
    await mkdir(join(tempDir, 'images'), { recursive: true });
    await writeFile(join(tempDir, 'images', 'hero.jpg'), Buffer.from([0xff, 0xd8]));
    const clean = await runCli('validate', mdPath);
    expect(clean.stderr).to.contain('No problems found');
  });

  it('--json emits machine-readable diagnostics', async () => {
    const mdPath = await writeDoc('## Gallery {[photGrid]}\n');
    const result = await runCli('validate', mdPath, '--json');
    const parsed = JSON.parse(result.stdout) as {
      errorCount: number;
      warningCount: number;
      infoCount: number;
      diagnostics: Array<{ code: string; line?: number }>;
    };
    expect(parsed.errorCount).to.equal(0);
    expect(parsed.warningCount).to.equal(1);
    expect(parsed.infoCount).to.equal(0);
    expect(parsed.diagnostics[0].code).to.equal('unknown-template');
    expect(parsed.diagnostics[0].line).to.equal(1);
  });

  it('reports info diagnostics, labels them info, and exits 0', async () => {
    // A key set in both {[…]} and {…} produces a `conflicting-annotation-key`
    // info diagnostic (the {…} value wins). Info must not fail the command.
    const mdPath = await writeDoc('## Timed {[quote duration=5]} {duration=10}\n\nA quote.\n');
    const result = await runCli('validate', mdPath);
    expect(result.exitCode).to.equal(0);
    expect(result.stderr).to.contain('conflicting-annotation-key');
    expect(result.stderr).to.contain('info');
    // Info diagnostics are not counted as warnings.
    expect(result.stderr).to.contain('0 warning(s)');
  });

  it('--json separates info diagnostics from warnings', async () => {
    const mdPath = await writeDoc('## Timed {[quote duration=5]} {duration=10}\n\nA quote.\n');
    const result = await runCli('validate', mdPath, '--json');
    const parsed = JSON.parse(result.stdout) as {
      errorCount: number;
      warningCount: number;
      infoCount: number;
      diagnostics: Array<{ severity: string; code: string }>;
    };
    expect(parsed.errorCount).to.equal(0);
    expect(parsed.warningCount).to.equal(0);
    expect(parsed.infoCount).to.be.greaterThan(0);
    expect(parsed.diagnostics.some((d) => d.severity === 'info')).to.equal(true);
  });
});
