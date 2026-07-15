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
 *   3. Run `node scripts/run-install-allowlist.mjs --print-pins` and paste the
 *      reported `scriptSha256` into the entry's `reviewed` block.
 *   4. Re-run `npm run install:safe` to verify the entry works.
 *
 * Removing entries from the allowlist is safe (the package just won't have its
 * postinstall run); the consequences are package-specific.
 *
 * ── Why the content pin exists ──────────────────────────────────────
 *
 * Allowlisting by NAME alone is not the promise the docs make. The human
 * review happens against the script as it exists at allowlist time, but this
 * script executes whatever `node_modules/<name>/<script>` is present at RUN
 * time. `esbuild` is a TRANSITIVE dependency (via tsup), so a routine tsup bump
 * can swap the executed code with no reviewer ever seeing it.
 *
 * So trust is pinned to the script's CONTENT (sha256), not its version: a
 * version bump that leaves the reviewed bytes untouched keeps working (routine
 * bumps don't break), while any change to the code we actually execute stops
 * the build with an explicit re-review instruction. `reviewed.version` is
 * recorded for context only — it is not a gate.
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Each entry must specify:
 *   - `name`:     the npm package name
 *   - `reason`:   why this package needs to run install scripts
 *   - `runner`:   { kind: 'node', script: 'install.js' }
 *                 → `node node_modules/<name>/<script>`
 *                 The script file is invoked directly so the exact bytes that
 *                 run are the exact bytes this script hashes and pins.
 *   - `reviewed`: the review record that makes the trust real:
 *       - `version`:      the version reviewed (context only, NOT a gate)
 *       - `scriptSha256`: sha256 of `node_modules/<name>/<runner.script>` as
 *                         reviewed. Execution is REFUSED on any mismatch.
 *
 * Note this only governs the hoisted top-level `node_modules/<name>` copy. If a
 * nested duplicate of an allowlisted package ever appears, its install script
 * is neither run nor pinned — see `assertSingleCopy`.
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
    reviewed: {
      version: '0.27.3',
      // Reviewed 2026-07: resolves the platform package for the current
      // os/arch, downloads `@esbuild/<platform>` from registry.npmjs.org at the
      // version in esbuild's own package.json, extracts the binary from the
      // tarball, chmods it, and writes the bin shim. Network access is limited
      // to the npm registry; no arbitrary code is fetched or evaluated.
      scriptSha256: '10f6fa3644d8d23d066ff67b0ae449074e75884503546a9fedb667f1dcb9ade2',
    },
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

/** sha256 of a file's exact bytes. */
function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/** Absolute path to an entry's install script. */
function scriptPathOf(entry) {
  return path.join(REPO_ROOT, 'node_modules', entry.name, entry.runner.script);
}

/**
 * Refuse to execute an install script whose bytes differ from the reviewed
 * ones. This is the whole point of the allowlist: the reviewer approved
 * specific CODE, not a package name.
 */
function assertReviewedScript(entry, version, scriptPath) {
  const { name, reviewed } = entry;
  if (!reviewed?.scriptSha256) {
    fail(
      `allowlist entry '${name}' has no reviewed.scriptSha256 pin.\n` +
        `  Review node_modules/${name}/${entry.runner.script}, then record its hash:\n` +
        `    node scripts/run-install-allowlist.mjs --print-pins`,
    );
  }

  const actual = sha256File(scriptPath);
  if (actual === reviewed.scriptSha256) return;

  fail(
    `${name}'s install script CHANGED since it was reviewed — refusing to run it.\n\n` +
      `  script:      node_modules/${name}/${entry.runner.script}\n` +
      `  reviewed:    ${reviewed.scriptSha256}${
        reviewed.version ? ` (v${reviewed.version})` : ''
      }\n` +
      `  now on disk: ${actual} (v${version})\n\n` +
      `This is expected after a dependency bump; it is not necessarily an attack.\n` +
      `To resolve, RE-REVIEW the script and update the pin:\n` +
      `  1. Read node_modules/${name}/${entry.runner.script} and confirm it still does\n` +
      `     only what the package documents (see the entry's 'reason').\n` +
      `  2. Update 'reviewed' for '${name}' in scripts/run-install-allowlist.mjs:\n` +
      `       version:      '${version}'\n` +
      `       scriptSha256: '${actual}'\n` +
      `  3. Re-run \`npm run install:safe\`.\n\n` +
      `Do NOT paste the new hash without reading the diff — that defeats the control.`,
  );
}

/**
 * The pin (and the run) only cover the hoisted top-level copy. A nested
 * duplicate would silently go unpinned and unbuilt, so surface it rather than
 * letting it look handled.
 */
function assertSingleCopy(entry) {
  const nested = path.join(REPO_ROOT, 'node_modules', entry.name, 'node_modules', entry.name);
  if (existsSync(nested)) {
    fail(
      `allowlist entry '${entry.name}' has a nested duplicate at ` +
        `${path.relative(REPO_ROOT, nested)}. This script only pins and runs the ` +
        `hoisted top-level copy; resolve the duplicate before continuing.`,
    );
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

  if (runner.kind !== 'node') {
    fail(`unknown runner kind for '${name}': ${runner.kind}`);
  }

  const scriptPath = scriptPathOf(entry);
  if (!existsSync(scriptPath)) {
    fail(`allowlist entry '${name}@${version}': script ${runner.script} not found`);
  }

  assertSingleCopy(entry);
  assertReviewedScript(entry, version, scriptPath);

  info(`${name}@${version}: node ${path.relative(REPO_ROOT, scriptPath)} (pin verified)`);
  execSync(`node "${scriptPath}"`, {
    cwd: path.join(REPO_ROOT, 'node_modules', name),
    stdio: 'inherit',
  });
  ok(`${name}@${version} install script complete`);
}

/** Print the on-disk pin for each entry, for use after a re-review. */
function printPins() {
  for (const entry of ALLOWLIST) {
    const version = readPkgVersion(entry.name);
    if (!version) {
      info(`${entry.name}: not installed`);
      continue;
    }
    const scriptPath = scriptPathOf(entry);
    if (!existsSync(scriptPath)) {
      info(`${entry.name}@${version}: ${entry.runner.script} not found`);
      continue;
    }
    console.log(
      `${entry.name}:\n` +
        `  version:      '${version}'\n` +
        `  scriptSha256: '${sha256File(scriptPath)}'`,
    );
  }
}

function main() {
  if (process.argv.includes('--print-pins')) {
    printPins();
    return;
  }
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
