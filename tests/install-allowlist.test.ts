import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';

/**
 * `scripts/run-install-allowlist.mjs` is a SECURITY CONTROL: `.npmrc` sets
 * `ignore-scripts=true` and this is the one place install scripts are allowed
 * to run. The documented promise is "read its install script, confirm what it
 * does, then allow" — so trust must be pinned to the script's CONTENT, not just
 * the package name. `esbuild` is transitive (via tsup), so a routine bump can
 * otherwise swap the executed code with no reviewer in the loop.
 *
 * These tests exercise the real script as a subprocess.
 */
describe('install-script allowlist', () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const runner = join(repoRoot, 'scripts', 'run-install-allowlist.mjs');
  const source = readFileSync(runner, 'utf8');
  const esbuildInstall = join(repoRoot, 'node_modules', 'esbuild', 'install.js');
  const backup = join(repoRoot, 'node_modules', 'esbuild', 'install.js.allowlist-test-bak');

  afterEach(() => {
    // Always restore a tampered script, even if an expectation failed.
    if (existsSync(backup)) {
      copyFileSync(backup, esbuildInstall);
      execFileSync(process.execPath, ['-e', `require('fs').unlinkSync(${JSON.stringify(backup)})`]);
    }
  });

  /** Run the allowlist script, capturing status + output. */
  function run(args: string[] = []): { status: number; output: string } {
    try {
      const output = execFileSync(process.execPath, [runner, ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, output };
    } catch (error: unknown) {
      const err = error as { status?: number; stdout?: string; stderr?: string };
      return { status: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  }

  it('pins every allowlist entry to a reviewed script hash', () => {
    // A name-only entry would silently execute unreviewed code.
    expect(source).toContain('scriptSha256');
    expect(source).toMatch(/reviewed:\s*\{/);
  });

  it('--print-pins reports the on-disk hash of the real install script', () => {
    const { status, output } = run(['--print-pins']);
    expect(status).toBe(0);

    const actual = createHash('sha256').update(readFileSync(esbuildInstall)).digest('hex');
    expect(output).toContain('esbuild');
    expect(output).toContain(actual);
  });

  it('the committed pin matches the installed esbuild install script', () => {
    // If this fails, esbuild changed: RE-REVIEW node_modules/esbuild/install.js
    // and update `reviewed` in scripts/run-install-allowlist.mjs.
    const actual = createHash('sha256').update(readFileSync(esbuildInstall)).digest('hex');
    expect(
      source,
      'esbuild install.js changed — re-review it and update the pin ' +
        '(node scripts/run-install-allowlist.mjs --print-pins)',
    ).toContain(actual);
  });

  it('REFUSES to execute a tampered install script', () => {
    copyFileSync(esbuildInstall, backup);
    appendFileSync(esbuildInstall, '\n// injected by a compromised dependency\n');

    const { status, output } = run();
    expect(status).toBe(1);
    expect(output).toContain('CHANGED since it was reviewed');
    expect(output).toContain('refusing to run it');
  });

  it('tells the reviewer exactly how to resolve a pin mismatch', () => {
    copyFileSync(esbuildInstall, backup);
    appendFileSync(esbuildInstall, '\n// injected\n');

    const { output } = run();
    const tamperedHash = createHash('sha256').update(readFileSync(esbuildInstall)).digest('hex');
    // The message must name the file, both hashes, and the re-review step —
    // a bare "hash mismatch" would be the cryptic failure we're avoiding.
    expect(output).toContain('node_modules/esbuild/install.js');
    expect(output).toContain(tamperedHash);
    expect(output).toContain('RE-REVIEW');
    expect(output).toMatch(/scripts\/run-install-allowlist\.mjs/);
  });

  it('runs the install script when the pin matches', () => {
    const { status, output } = run();
    expect(status).toBe(0);
    expect(output).toContain('pin verified');
  });
});
