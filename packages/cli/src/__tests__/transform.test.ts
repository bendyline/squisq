/**
 * transform command integration tests
 *
 * Exercises `squisq transform` against the built CLI: stdout piping,
 * ordered --ops application, --width, -o with the overwrite guard,
 * --in-place, and exit codes for bad input/ops.
 */

import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

const WRAPPED_DOC = '# Title\n\nHello wrapped\nworld of text.\n';
const UNWRAPPED_BODY = 'Hello wrapped world of text.';

describe('transform command', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `squisq-transform-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function writeDoc(content: string, name = 'doc.md'): Promise<string> {
    const p = join(tempDir, name);
    await writeFile(p, content, 'utf-8');
    return p;
  }

  it('writes the transformed markdown to stdout by default', async () => {
    const mdPath = await writeDoc(WRAPPED_DOC);
    const result = await runCli('transform', mdPath, '--ops', 'unwrap');
    expect(result.exitCode).to.equal(0);
    expect(result.stdout).to.equal(`# Title\n\n${UNWRAPPED_BODY}\n`);
    expect(result.stderr).to.contain('✓ unwrap');
  });

  it('applies ops in order and reports per-op status', async () => {
    const mdPath = await writeDoc('* item one\n* item two\n');
    const result = await runCli('transform', mdPath, '--ops', 'unwrap,cleanup');
    expect(result.exitCode).to.equal(0);
    expect(result.stdout).to.equal('- item one\n- item two\n');
    expect(result.stderr).to.contain('unwrap (no changes)');
    expect(result.stderr).to.contain('cleanup');
  });

  it('wraps at the requested --width', async () => {
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const mdPath = await writeDoc(`${words}\n`);
    const result = await runCli('transform', mdPath, '--ops', 'wrap', '--width', '40');
    expect(result.exitCode).to.equal(0);
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines.length).to.be.greaterThan(1);
    for (const line of lines) expect(line.length).to.be.at.most(40);
  });

  it('rejects unknown ops with a helpful error', async () => {
    const mdPath = await writeDoc(WRAPPED_DOC);
    const result = await runCli('transform', mdPath, '--ops', 'unwrap,frobnicate');
    expect(result.exitCode).to.equal(1);
    expect(result.stderr).to.contain('unknown transform "frobnicate"');
    expect(result.stderr).to.contain('unwrap, wrap, cleanup');
    expect(result.stdout).to.equal('');
  });

  it('exits 2 for an unreadable input file', async () => {
    const result = await runCli('transform', join(tempDir, 'missing.md'), '--ops', 'unwrap');
    expect(result.exitCode).to.equal(2);
    expect(result.stderr).to.contain('could not read input');
  });

  it('writes to -o and refuses to overwrite without --overwrite', async () => {
    const mdPath = await writeDoc(WRAPPED_DOC);
    const outPath = join(tempDir, 'out.md');

    const first = await runCli('transform', mdPath, '--ops', 'unwrap', '-o', outPath);
    expect(first.exitCode).to.equal(0);
    expect(await readFile(outPath, 'utf-8')).to.equal(`# Title\n\n${UNWRAPPED_BODY}\n`);
    expect(first.stdout).to.equal('');

    const second = await runCli('transform', mdPath, '--ops', 'unwrap', '-o', outPath);
    expect(second.exitCode).to.equal(1);
    expect(second.stderr).to.contain('already exist');

    const third = await runCli(
      'transform',
      mdPath,
      '--ops',
      'unwrap',
      '-o',
      outPath,
      '--overwrite',
    );
    expect(third.exitCode).to.equal(0);
  });

  it('rewrites the input with --in-place', async () => {
    const mdPath = await writeDoc(WRAPPED_DOC);
    const result = await runCli('transform', mdPath, '--ops', 'unwrap', '--in-place');
    expect(result.exitCode).to.equal(0);
    expect(await readFile(mdPath, 'utf-8')).to.equal(`# Title\n\n${UNWRAPPED_BODY}\n`);
    expect(result.stdout).to.equal('');
  });

  it('refuses -o together with --in-place', async () => {
    const mdPath = await writeDoc(WRAPPED_DOC);
    const result = await runCli(
      'transform',
      mdPath,
      '--ops',
      'unwrap',
      '-o',
      join(tempDir, 'x.md'),
      '--in-place',
    );
    expect(result.exitCode).to.not.equal(0);
    expect(result.stderr.toLowerCase()).to.contain('cannot be used with');
  });

  it('preserves frontmatter and code fences through cleanup', async () => {
    const doc = '---\n# note\ntitle: T\n---\n\n```\ncode  stays\n```\n\n* item\n';
    const mdPath = await writeDoc(doc);
    const result = await runCli('transform', mdPath, '--ops', 'cleanup');
    expect(result.exitCode).to.equal(0);
    expect(result.stdout).to.contain('---\n# note\ntitle: T\n---\n');
    expect(result.stdout).to.contain('```\ncode  stays\n```');
    expect(result.stdout).to.contain('- item');
  });
});
