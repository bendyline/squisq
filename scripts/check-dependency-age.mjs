#!/usr/bin/env node
/**
 * Dependency cooldown gate — refuse npm package versions that are too young.
 *
 * ── Threat model ────────────────────────────────────────────────────
 *
 * The dominant npm supply-chain attack is account or token takeover: an
 * attacker publishes a malicious patch release of an otherwise reputable
 * package and waits for the ecosystem to pull it in. Those releases are
 * short-lived — they get reported, unpublished, or superseded within hours to a
 * couple of days, because they are noisy by nature (they exfiltrate, they phone
 * home, they get caught by scanners and by the maintainer waking up).
 *
 * So the cheapest effective defense is TIME. Do not install anything the
 * ecosystem has not already had a chance to look at. This script enforces that:
 * every version resolved in `package-lock.json` must have been published at
 * least `--min-age-days` (default 7) ago, per the npm registry's own publish
 * timestamps.
 *
 * This complements, and does not replace, the install-script allowlist
 * (`scripts/run-install-allowlist.mjs`) and `npm audit`. Note the tension with
 * `npm audit fix`: it will happily adopt an advisory fix published minutes ago.
 * That is exactly the case this gate exists to catch — see "When a bump is
 * genuinely urgent" below.
 *
 * ── Modes ───────────────────────────────────────────────────────────
 *
 *   Changed-only (default). Diffs `package-lock.json` against a base ref and
 *   checks only the versions this branch ADDS or CHANGES. This is the PR gate:
 *   fast (a handful of registry lookups) and precise about what a change is
 *   actually introducing.
 *
 *   Full audit (`--all`). Checks every registry-resolved version in the
 *   lockfile. Slower — one packument per distinct package name — and used for
 *   the scheduled backstop sweep and for on-demand audits.
 *
 * ── Usage ───────────────────────────────────────────────────────────
 *
 *   node scripts/check-dependency-age.mjs                  # changed vs base ref
 *   node scripts/check-dependency-age.mjs --all            # full audit
 *   node scripts/check-dependency-age.mjs --base <ref>     # explicit base
 *   node scripts/check-dependency-age.mjs --min-age-days 14
 *   node scripts/check-dependency-age.mjs --all --json     # machine-readable
 *
 * Options:
 *   --all                 Audit every registry-resolved version in the lockfile.
 *   --base <ref>          Git ref to diff the lockfile against (changed-only
 *                         mode). Default: $SQUISQ_DEP_AGE_BASE, else
 *                         origin/main, else main, else HEAD~1.
 *   --lockfile <path>     Audit a lockfile other than the repo's own. Requires
 *                         --all, since "changed versus the base ref" has no
 *                         meaning for a lockfile that is not the repo's.
 *   --min-age-days <n>    Cooldown window in days. Default 7, or
 *                         $SQUISQ_DEP_MIN_AGE_DAYS.
 *   --registry <url>      Registry base URL. Default https://registry.npmjs.org.
 *   --concurrency <n>     Parallel registry requests. Default 8.
 *   --no-cache            Ignore (and do not write) the publish-time cache.
 *   --json                Print a JSON report to stdout instead of prose.
 *
 * Exit codes:
 *   0  every checked version satisfies the cooldown
 *   1  policy violation — at least one version is too young, or undatable
 *   2  operational failure — bad arguments, unreadable lockfile, registry
 *      unreachable. Deliberately distinct from 1: "we could not check" must
 *      never be mistaken for "we checked and it is fine".
 *
 * ── When a bump is genuinely urgent ─────────────────────────────────
 *
 * Sometimes you must take a same-day release (an actively exploited CVE in a
 * dependency we ship). Add an entry to EXCEPTIONS below, pinned to the exact
 * name AND version, with a reason. Exceptions expire on their own: once the
 * version ages past the cooldown it passes normally, and this script then
 * reports the entry as stale so it gets deleted. An exception is a decision to
 * trust code the ecosystem has not vetted yet — take it deliberately, and read
 * the diff.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOCKFILE_NAME = 'package-lock.json';
const DEFAULT_MIN_AGE_DAYS = 7;
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 60_000;
const REQUEST_ATTEMPTS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deliberate, temporary exemptions from the cooldown.
 *
 * Each entry must specify:
 *   - `name`:    the npm package name
 *   - `version`: the exact version being exempted (never a range — the point is
 *                that one specific artifact was reviewed)
 *   - `reason`:  why this could not wait out the cooldown, and what was done
 *                instead (who read the diff, which advisory forced it)
 *
 * Entries self-expire: they stop mattering once the version is old enough, and
 * the script then reports them as stale so they can be removed.
 *
 * @type {{ name: string, version: string, reason: string }[]}
 */
const EXCEPTIONS = [];

/** Cache of `name@version` to ISO publish time. Publish times are immutable. */
const CACHE_PATH = path.join(REPO_ROOT, 'node_modules', '.cache', 'squisq', 'dependency-age.json');

const ESC = String.fromCharCode(27);
const RED = ESC + '[31m';
const YELLOW = ESC + '[33m';
const GREEN = ESC + '[32m';
const CYAN = ESC + '[36m';
const DIM = ESC + '[2m';
const RESET = ESC + '[0m';

const useColor = !process.env.NO_COLOR;
const paint = (code, msg) => (useColor ? `${code}${msg}${RESET}` : String(msg));

/** Marker for a failure whose message has already been printed. */
class GateFailure extends Error {}

/**
 * Operational failure: we could not run the check. Never conflate with a
 * violation — the caller distinguishes exit 2 from exit 1.
 *
 * Throws rather than calling `process.exit()`, and every exit path sets
 * `process.exitCode` instead. Calling `process.exit()` while `fetch`'s
 * keep-alive sockets are still live aborts the process on Windows
 * ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"), which replaces a
 * meaningful exit code with a crash code — the one thing a gate must not do.
 */
function fail(msg) {
  console.error(`${paint(RED, 'error:')} ${msg}`);
  throw new GateFailure(msg);
}

function info(msg) {
  console.error(`${paint(CYAN, '>')} ${msg}`);
}

function warn(msg) {
  console.error(`${paint(YELLOW, 'warning:')} ${msg}`);
}

function ok(msg) {
  console.error(`${paint(GREEN, 'OK')} ${msg}`);
}

function stripTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

/* ── Arguments ─────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const opts = {
    all: false,
    lockfile: path.join(REPO_ROOT, LOCKFILE_NAME),
    base: process.env.SQUISQ_DEP_AGE_BASE || null,
    minAgeDays: Number(process.env.SQUISQ_DEP_MIN_AGE_DAYS || DEFAULT_MIN_AGE_DAYS),
    registry: stripTrailingSlashes(process.env.SQUISQ_DEP_AGE_REGISTRY || DEFAULT_REGISTRY),
    concurrency: DEFAULT_CONCURRENCY,
    cache: true,
    json: false,
  };

  const takeValue = (flag, index) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`${flag} requires a value`);
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') {
      opts.all = true;
    } else if (arg === '--base') {
      opts.base = takeValue(arg, i);
      i += 1;
    } else if (arg === '--lockfile') {
      opts.lockfile = path.resolve(takeValue(arg, i));
      i += 1;
    } else if (arg === '--min-age-days') {
      opts.minAgeDays = Number(takeValue(arg, i));
      i += 1;
    } else if (arg === '--registry') {
      opts.registry = stripTrailingSlashes(takeValue(arg, i));
      i += 1;
    } else if (arg === '--concurrency') {
      opts.concurrency = Number(takeValue(arg, i));
      i += 1;
    } else if (arg === '--no-cache') {
      opts.cache = false;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(opts.minAgeDays) || opts.minAgeDays < 0) {
    fail(`--min-age-days must be a non-negative number (got ${opts.minAgeDays})`);
  }
  if (!Number.isInteger(opts.concurrency) || opts.concurrency < 1) {
    fail(`--concurrency must be a positive integer (got ${opts.concurrency})`);
  }
  if (!opts.all && opts.lockfile !== path.join(REPO_ROOT, LOCKFILE_NAME)) {
    fail('--lockfile requires --all (a foreign lockfile has no base ref to diff against)');
  }
  return opts;
}

/* ── Lockfile ──────────────────────────────────────────────────────── */

/**
 * True when a lockfile `resolved` URL points at an npm-registry tarball.
 * Registry tarball paths always contain a `/-/` segment; that shape is what
 * distinguishes them from git and arbitrary-https resolutions.
 */
function isRegistryTarball(resolved, registryUrl) {
  if (!resolved) return false;
  if (resolved.startsWith(`${registryUrl}/`)) return true;
  if (!resolved.startsWith('http')) return false;
  return resolved.includes('/-/');
}

/**
 * Every distinct registry-resolved `name@version` in a lockfile, with the
 * node_modules paths that install it (so a violation can name its dependents).
 *
 * Workspace links and bundled deps are skipped — they are not separately
 * published artifacts. Anything else that resolves to something OTHER than a
 * registry tarball is surfaced instead of dropped: "we cannot date it" is a
 * finding, not a silent pass.
 *
 * @returns {{ versions: Map<string, { name: string, version: string, paths: string[] }>,
 *             unresolvable: { path: string, resolved: string }[] }}
 */
function collectLockVersions(lockJson, registryUrl) {
  const packages = lockJson.packages;
  if (!packages || typeof packages !== 'object') {
    fail(
      `${LOCKFILE_NAME} has no "packages" map (lockfileVersion ${lockJson.lockfileVersion}). ` +
        'This gate requires npm lockfile v2 or v3.',
    );
  }

  const versions = new Map();
  const unresolvable = [];
  const marker = 'node_modules/';

  for (const [pkgPath, entry] of Object.entries(packages)) {
    if (!pkgPath) continue; // the root project itself
    if (!entry || entry.link) continue; // workspace symlink
    if (!entry.version) continue; // bare workspace declaration
    if (entry.inBundle) continue; // ships inside another package's tarball

    const index = pkgPath.lastIndexOf(marker);
    const name = entry.name || (index >= 0 ? pkgPath.slice(index + marker.length) : pkgPath);
    const resolved = entry.resolved || '';

    if (!isRegistryTarball(resolved, registryUrl)) {
      if (resolved) unresolvable.push({ path: pkgPath, resolved });
      continue;
    }

    const key = `${name}@${entry.version}`;
    const existing = versions.get(key);
    if (existing) existing.paths.push(pkgPath);
    else versions.set(key, { name, version: entry.version, paths: [pkgPath] });
  }

  return { versions, unresolvable };
}

function readWorkingLockfile(lockPath) {
  if (!existsSync(lockPath)) fail(`lockfile not found at ${lockPath}`);
  try {
    return JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch (err) {
    fail(`could not parse ${lockPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function git(args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function refExists(ref) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** First usable base ref, or null when this checkout has no comparable history. */
function resolveBaseRef(explicit) {
  const candidates = explicit ? [explicit] : ['origin/main', 'main', 'HEAD~1'];
  for (const ref of candidates) {
    if (refExists(ref)) return ref;
  }
  return null;
}

/** The lockfile as of `ref`, or null when it cannot be read there. */
function readLockfileAtRef(ref) {
  try {
    return JSON.parse(git(['show', `${ref}:${LOCKFILE_NAME}`]));
  } catch {
    return null;
  }
}

/* ── Publish times ─────────────────────────────────────────────────── */

function loadCache(enabled) {
  if (!enabled || !existsSync(CACHE_PATH)) return new Map();
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(CACHE_PATH, 'utf8'))));
  } catch {
    return new Map();
  }
}

function saveCache(enabled, cache) {
  if (!enabled) return;
  try {
    mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    // The cache is an optimization; never let it decide whether the gate runs.
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The `time` map from a package's full packument.
 *
 * The abbreviated document (`application/vnd.npm.install-v1+json`) omits
 * publish times, and the single-version endpoint does not carry them either, so
 * the full packument is the only source — which is why results are cached and
 * why the default mode only looks up what actually changed.
 */
async function fetchPublishTimes(name, registryUrl) {
  const url = `${registryUrl}/${name.split('/').join('%2f')}`;
  let lastError = null;

  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 404) return {};
      if (res.ok) {
        const body = await res.json();
        return body && typeof body.time === 'object' && body.time ? body.time : {};
      }
      lastError = new Error(`HTTP ${res.status} ${res.statusText}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    if (attempt < REQUEST_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1));
  }

  throw new Error(`${name}: ${lastError ? lastError.message : 'unknown registry failure'}`);
}

async function mapLimit(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

/**
 * Resolve a publish time for every requested `name@version`, filling `cache`.
 * Grouped by package name so one packument answers all of its versions.
 *
 * @returns {Promise<string[]>} messages for names that could not be fetched
 */
async function resolvePublishTimes(entries, opts, cache) {
  const byName = new Map();
  for (const entry of entries) {
    if (cache.has(`${entry.name}@${entry.version}`)) continue;
    const list = byName.get(entry.name);
    if (list) list.push(entry.version);
    else byName.set(entry.name, [entry.version]);
  }

  const names = [...byName.keys()];
  if (names.length === 0) return [];
  if (!opts.json) {
    info(`Fetching publish times for ${names.length} package name(s) from ${opts.registry} ...`);
  }

  const failures = [];
  let done = 0;
  await mapLimit(names, opts.concurrency, async (name) => {
    try {
      const times = await fetchPublishTimes(name, opts.registry);
      for (const version of byName.get(name)) {
        const published = times[version];
        if (typeof published === 'string') cache.set(`${name}@${version}`, published);
      }
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
    done += 1;
    if (!opts.json && names.length > 100 && done % 100 === 0) {
      info(`  ... ${done}/${names.length}`);
    }
  });

  return failures;
}

/* ── Reporting ─────────────────────────────────────────────────────── */

const round1 = (n) => Math.round(n * 10) / 10;

function describeDependents(entry) {
  const shown = entry.paths.slice(0, 3).join(', ');
  const more = entry.paths.length > 3 ? `, +${entry.paths.length - 3} more` : '';
  return `    ${paint(DIM, `via ${shown}${more}`)}`;
}

function printHumanReport(report) {
  const { minAgeDays } = report;

  if (report.stale.length > 0) {
    warn(
      `${report.stale.length} cooldown exception(s) are no longer needed (the version has aged ` +
        'past the window) — delete them from EXCEPTIONS in scripts/check-dependency-age.mjs:',
    );
    for (const item of report.stale) console.error(`    ${item.name}@${item.version}`);
  }

  if (report.exempted.length > 0) {
    warn(`${report.exempted.length} version(s) inside the cooldown are explicitly exempted:`);
    for (const item of report.exempted) {
      console.error(`    ${item.name}@${item.version} — ${item.reason}`);
    }
  }

  if (report.unresolvable.length > 0) {
    warn(
      `${report.unresolvable.length} lockfile entries do not resolve to an npm registry tarball ` +
        'and cannot be dated:',
    );
    for (const item of report.unresolvable.slice(0, 10)) {
      console.error(`    ${item.path} -> ${item.resolved}`);
    }
  }

  if (report.undatable.length > 0) {
    console.error('');
    console.error(
      `${paint(RED, 'error:')} ${report.undatable.length} version(s) have no publish time on the registry:`,
    );
    for (const item of report.undatable) {
      console.error(
        `  ${paint(RED, `${item.name}@${item.version}`)}  (absent from the packument "time" map)`,
      );
      console.error(describeDependents(item));
    }
    console.error(
      `  ${paint(DIM, 'A version we cannot date is a version we cannot vouch for. Pin to one the registry can date.')}`,
    );
  }

  if (report.tooYoung.length > 0) {
    console.error('');
    console.error(
      `${paint(RED, 'error:')} ${report.tooYoung.length} dependency version(s) are younger than ` +
        `the ${minAgeDays}-day cooldown:`,
    );
    for (const item of report.tooYoung) {
      console.error(
        `  ${paint(RED, `${item.name}@${item.version}`)}  published ${item.published} ` +
          `(${round1(item.ageDays)}d old, ${round1(minAgeDays - item.ageDays)}d to go)`,
      );
      console.error(describeDependents(item));
    }
    console.error('');
    console.error('  Resolve by one of:');
    console.error('    - wait out the cooldown, then re-run `npm run install:safe` (preferred)');
    console.error(`    - pin to the newest version already older than ${minAgeDays} days`);
    console.error('    - for an actively exploited CVE only, add a reviewed entry to EXCEPTIONS');
    console.error('      in scripts/check-dependency-age.mjs');
  }

  if (report.tooYoung.length === 0 && report.undatable.length === 0) {
    if (report.checked === 0) {
      ok(`No new or changed dependency versions to check (base ${report.base || 'n/a'}).`);
    } else {
      const scope =
        report.mode === 'all'
          ? `all ${report.checked} lockfile version(s)`
          : `${report.checked} new or changed version(s)`;
      const youngest = report.youngest
        ? ` Youngest: ${report.youngest.name}@${report.youngest.version} at ${round1(report.youngest.ageDays)}d.`
        : '';
      ok(`${scope} satisfy the ${minAgeDays}-day cooldown.${youngest}`);
    }
  }

  if (report.mode === 'all' && report.recent.length > 0) {
    console.error('');
    console.error(paint(CYAN, 'Most recently published dependencies:'));
    for (const item of report.recent) {
      console.error(
        `  ${String(round1(item.ageDays)).padStart(7)}d  ${item.name}@${item.version}  ` +
          paint(DIM, item.published.slice(0, 10)),
      );
    }
  }
}

/* ── Main ──────────────────────────────────────────────────────────── */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const now = Date.now();
  const cutoff = now - opts.minAgeDays * DAY_MS;

  const head = collectLockVersions(readWorkingLockfile(opts.lockfile), opts.registry);

  let mode = opts.all ? 'all' : 'changed';
  let base = null;
  let toCheck = [...head.versions.values()];

  if (mode === 'changed') {
    base = resolveBaseRef(opts.base);
    const baseLock = base ? readLockfileAtRef(base) : null;
    if (!baseLock) {
      warn(
        `could not read ${LOCKFILE_NAME} at base ref ${base || '(none found)'} — falling back ` +
          'to a full audit so nothing goes unchecked.',
      );
      mode = 'all';
    } else {
      const baseVersions = collectLockVersions(baseLock, opts.registry).versions;
      toCheck = toCheck.filter((entry) => !baseVersions.has(`${entry.name}@${entry.version}`));
      if (!opts.json) {
        info(
          `Comparing ${LOCKFILE_NAME} against ${base}: ${toCheck.length} new or changed ` +
            `version(s) out of ${head.versions.size}.`,
        );
      }
    }
  }

  if (mode === 'all' && !opts.json) {
    info(`Auditing all ${head.versions.size} registry-resolved version(s) in ${LOCKFILE_NAME}.`);
  }

  const cache = loadCache(opts.cache);
  const fetchFailures = await resolvePublishTimes(toCheck, opts, cache);
  saveCache(opts.cache, cache);

  if (fetchFailures.length > 0) {
    for (const message of fetchFailures.slice(0, 10)) console.error(`    ${message}`);
    fail(
      `${fetchFailures.length} registry lookup(s) failed, so the cooldown cannot be proven. ` +
        'Re-run when the registry is reachable.',
    );
  }

  const exceptionFor = (name, version) =>
    EXCEPTIONS.find((item) => item.name === name && item.version === version) || null;

  const tooYoung = [];
  const undatable = [];
  const exempted = [];
  const dated = [];

  for (const entry of toCheck) {
    const published = cache.get(`${entry.name}@${entry.version}`);
    if (!published) {
      const exception = exceptionFor(entry.name, entry.version);
      if (exception) exempted.push({ ...entry, published: null, reason: exception.reason });
      else undatable.push(entry);
      continue;
    }

    const publishedMs = Date.parse(published);
    const record = { ...entry, published, ageDays: (now - publishedMs) / DAY_MS };
    dated.push(record);
    if (publishedMs > cutoff) {
      const exception = exceptionFor(entry.name, entry.version);
      if (exception) exempted.push({ ...record, reason: exception.reason });
      else tooYoung.push(record);
    }
  }

  const stale = EXCEPTIONS.filter(
    (item) => !exempted.some((used) => used.name === item.name && used.version === item.version),
  );

  dated.sort((a, b) => a.ageDays - b.ageDays);

  const report = {
    mode,
    base,
    minAgeDays: opts.minAgeDays,
    checked: toCheck.length,
    totalInLockfile: head.versions.size,
    tooYoung,
    undatable,
    exempted,
    stale,
    unresolvable: head.unresolvable,
    youngest: dated[0] || null,
    recent: dated.slice(0, 10),
  };

  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else printHumanReport(report);

  process.exitCode = tooYoung.length > 0 || undatable.length > 0 ? 1 : 0;
}

main().catch((err) => {
  process.exitCode = 2;
  if (err instanceof GateFailure) return; // already reported
  console.error(
    `${paint(RED, 'error:')} ${err instanceof Error ? err.stack || err.message : String(err)}`,
  );
});
