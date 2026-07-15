/**
 * Regression: importing the CLI package ROOT executed the CLI.
 *
 * `main`/`exports["."]` pointed at `dist/index.js`, whose module body prints a
 * banner and calls `program.parse()`. A host doing `import '@bendyline/squisq-cli'`
 * (instead of `/api`) therefore parsed the HOST process's argv: commander
 * printed help or an "unknown command" error and could call `process.exit`.
 *
 * The root now resolves to the inert `dist/api.js`; only `bin` (which bypasses
 * the exports map) points at the executable entry.
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const exec = promisify(execFile);

const PKG_DIR = join(import.meta.dirname, '..', '..');
const CLI_PATH = join(PKG_DIR, 'dist', 'index.js');

interface PackageJson {
  main?: string;
  types?: string;
  bin?: Record<string, string>;
  exports?: Record<string, { types?: string; import?: string; default?: string }>;
}

async function readPackageJson(): Promise<PackageJson> {
  return JSON.parse(await readFile(join(PKG_DIR, 'package.json'), 'utf-8')) as PackageJson;
}

/** Import a specifier in a fresh process, with argv that would trip commander. */
async function importInChildProcess(
  specifier: string,
  extraArgv: string[] = [],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const script = `const m = await import(${JSON.stringify(specifier)});
    console.log('IMPORT_OK:' + Object.keys(m).length);`;
  try {
    const { stdout, stderr } = await exec(
      'node',
      ['--input-type=module', '-e', script, ...extraArgv],
      { cwd: PKG_DIR, timeout: 60_000 },
    );
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.code ?? 1 };
  }
}

describe('package entry points', () => {
  it('does not execute the CLI when the package root is imported', async () => {
    // `serve --port 3000` is exactly the kind of host argv that made commander
    // print "unknown command 'serve'" and exit non-zero.
    const result = await importInChildProcess('@bendyline/squisq-cli', ['serve', '--port', '3000']);

    expect(result.stdout).to.contain('IMPORT_OK:');
    expect(result.exitCode).to.equal(0);
    expect(result.stderr).to.not.contain('squiggly square'); // the CLI banner
    expect(result.stderr).to.not.contain('unknown command');
    expect(result.stderr).to.not.contain('Usage:');
  });

  it('does not print help when the host argv contains commander keywords', async () => {
    // `help` is commander's built-in subcommand; `node` passes it through to the
    // script untouched (unlike `--help`, which node intercepts for itself).
    const result = await importInChildProcess('@bendyline/squisq-cli', ['help']);
    expect(result.exitCode).to.equal(0);
    expect(result.stdout).to.contain('IMPORT_OK:');
    expect(result.stdout).to.not.contain('Usage: squisq');
    expect(result.stderr).to.not.contain('squiggly square');
  });

  it('exports the programmatic surface from the root rather than nothing', async () => {
    const script = `const m = await import('@bendyline/squisq-cli');
      console.log(typeof m.renderDocToMp4, typeof m.convert);`;
    const { stdout } = await exec('node', ['--input-type=module', '-e', script], {
      cwd: PKG_DIR,
      timeout: 60_000,
    });
    expect(stdout).to.contain('function function');
  });

  it('keeps /api importable and inert', async () => {
    const result = await importInChildProcess('@bendyline/squisq-cli/api', ['convert', 'x.md']);
    expect(result.exitCode).to.equal(0);
    expect(result.stderr).to.not.contain('squiggly square');
  });

  it('resolves the root and /api to the same inert module', async () => {
    const pkg = await readPackageJson();
    expect(pkg.main).to.equal('./dist/api.js');
    expect(pkg.types).to.equal('./dist/api.d.ts');
    expect(pkg.exports?.['.']?.import).to.equal('./dist/api.js');
    expect(pkg.exports?.['.']?.types).to.equal('./dist/api.d.ts');
  });

  it('never exposes the executable entry through the exports map', async () => {
    const pkg = await readPackageJson();
    const exported = JSON.stringify(pkg.exports);
    expect(exported).to.not.contain('index.js');
  });

  it('keeps the bin entry pointing at the executable', async () => {
    const pkg = await readPackageJson();
    expect(pkg.bin?.squisq).to.equal('./dist/index.js');
    // ...and it is actually built and runnable.
    expect((await stat(CLI_PATH)).size).to.be.greaterThan(0);
  });

  it('still runs the CLI through the bin entry', async () => {
    const { stderr } = await exec('node', [CLI_PATH, '--help'], { timeout: 60_000 });
    expect(stderr).to.contain('squiggly square');
  });

  it('points every exports target at a file that was actually built', async () => {
    const pkg = await readPackageJson();
    for (const entry of Object.values(pkg.exports ?? {})) {
      for (const target of [entry.types, entry.import, entry.default]) {
        if (!target) continue;
        const info = await stat(join(PKG_DIR, target));
        expect(info.size, `${target} should be a built file`).to.be.greaterThan(0);
      }
    }
  });
});
