#!/usr/bin/env node
/**
 * Run install scripts for an explicit allowlist of trusted third-party packages.
 *
 * Squisq disables all third-party install / preinstall / postinstall scripts by
 * default via `.npmrc` (`ignore-scripts=true`). This script is the one place
 * where install scripts are deliberately allowed to run, for the small set of
 * packages that need them to function.
 *
 * To add a package to the allowlist:
 *   1. Read the package's install / preinstall / postinstall script.
 *      Verify it does nothing more than what the package's documentation says.
 *   2. Add an entry to the ALLOWLIST below with a one-line justification
 *      (`reason`) so the next reviewer knows why it was added.
 *   3. Re-run `npm run install:safe` to verify the entry works.
 *
 * Removing entries from the allowlist is safe (the package just won't have its
 * postinstall run); the consequences are package-specific.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Each entry must specify:
 *   - `name`:    the npm package name
 *   - `reason`:  why this package needs to run install scripts
 *   - `runner`:  one of:
 *       { kind: 'rebuild' }                       → `npm rebuild --ignore-scripts=false <name>`
 *       { kind: 'node', script: 'install.js' }    → `node node_modules/<name>/<script>`
 *     `kind: 'node'` is preferred when the package ships an explicit install
 *     script file we can invoke directly; it skips the npm rebuild round-trip
 *     and is harder to confuse.
 */
const ALLOWLIST = [
  {
    name: 'esbuild',
    reason:
      'tsup depends on esbuild; esbuild ships only the JS shim in npm and downloads ' +
      'a platform-specific native binary in its postinstall. Without this, `npm run ' +
      "build` fails with 'You installed esbuild for another platform than the one you " +
      "are currently using' or 'Cannot find module @esbuild/<platform>'.",
    runner: { kind: 'node', script: 'install.js' },
  },
];

function fail(msg) {
  console.error(`\x1b[31merror:\x1b[0m ${msg}`);
  process.exit(1);
}

function info(msg) {
  console.log(`\x1b[36m›\x1b[0m ${msg}`);
}

function ok(msg) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}

function readPkgVersion(pkgName) {
  const pkgPath = path.join(REPO_ROOT, 'node_modules', pkgName, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  } catch {
    return null;
  }
}

function runEntry(entry) {
  const { name, runner } = entry;
  const version = readPkgVersion(name);
  if (!version) {
    fail(
      `allowlist entry '${name}' is not installed. ` +
        `Run \`npm install\` first, then re-run this script.`,
    );
  }

  if (runner.kind === 'node') {
    const scriptPath = path.join(REPO_ROOT, 'node_modules', name, runner.script);
    if (!existsSync(scriptPath)) {
      fail(`allowlist entry '${name}@${version}': script ${runner.script} not found`);
    }
    info(`${name}@${version}: node ${path.relative(REPO_ROOT, scriptPath)}`);
    execSync(`node "${scriptPath}"`, {
      cwd: path.join(REPO_ROOT, 'node_modules', name),
      stdio: 'inherit',
    });
    ok(`${name}@${version} install script complete`);
    return;
  }

  if (runner.kind === 'rebuild') {
    info(`${name}@${version}: npm rebuild --ignore-scripts=false ${name}`);
    execSync(`npm rebuild --ignore-scripts=false ${name}`, {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    ok(`${name}@${version} rebuilt`);
    return;
  }

  fail(`unknown runner kind for '${name}': ${runner.kind}`);
}

function main() {
  if (ALLOWLIST.length === 0) {
    info('install-script allowlist is empty; nothing to run');
    return;
  }
  info(
    `Running install scripts for ${ALLOWLIST.length} allowlisted package(s): ` +
      ALLOWLIST.map((e) => e.name).join(', '),
  );
  for (const entry of ALLOWLIST) runEntry(entry);
}

main();
