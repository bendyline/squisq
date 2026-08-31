import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * `scripts/check-dependency-age.mjs` is a SECURITY CONTROL: it is what stops us
 * adopting a freshly-published (and therefore un-vetted) npm version — the
 * shape a takeover release takes, and precisely what `npm audit fix` will pull
 * in unasked.
 *
 * A gate that silently passes is worse than no gate, so these tests exercise
 * the real script as a subprocess against a LOCAL fake registry with controlled
 * publish times. No network, no clock skew, no dependence on what the public
 * registry happens to hold today.
 */
describe('dependency cooldown gate', () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const gate = join(repoRoot, 'scripts', 'check-dependency-age.mjs');
  const source = readFileSync(gate, 'utf8');

  const DAY_MS = 24 * 60 * 60 * 1000;
  const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

  /** name -> version -> ISO publish time. A name mapped to null 404s. */
  type Packuments = Record<string, Record<string, string> | null>;

  let server: Server;
  let registryUrl = '';
  let packuments: Packuments = {};
  let workDir = '';

  beforeAll(async () => {
    server = createServer((req, res) => {
      // Scoped names arrive percent-encoded (@scope%2fname).
      const name = decodeURIComponent((req.url ?? '/').slice(1)).replace(/%2f/gi, '/');
      const times = packuments[name];
      if (!times) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name, time: { created: times[Object.keys(times)[0]], ...times } }));
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (typeof address === 'string' || address === null) throw new Error('no port');
    registryUrl = `http://127.0.0.1:${address.port}`;
    workDir = mkdtempSync(join(tmpdir(), 'squisq-cooldown-'));
  });

  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  afterEach(() => {
    packuments = {};
  });

  /** A lockfile v3 whose entries resolve to tarballs on the fake registry. */
  function writeLockfile(
    packages: Record<string, Record<string, unknown>>,
    fileName = 'package-lock.json',
  ): string {
    const lockPath = join(workDir, fileName);
    writeFileSync(
      lockPath,
      JSON.stringify({
        name: 'fixture',
        lockfileVersion: 3,
        requires: true,
        packages: { '': { name: 'fixture', version: '1.0.0' }, ...packages },
      }),
    );
    return lockPath;
  }

  /** A normal registry-resolved lockfile entry. */
  function dep(name: string, version: string) {
    return { version, resolved: `${registryUrl}/${name}/-/${name}-${version}.tgz` };
  }

  interface Report {
    mode: string;
    checked: number;
    minAgeDays: number;
    tooYoung: { name: string; version: string; ageDays: number }[];
    undatable: { name: string; version: string }[];
    exempted: { name: string; version: string; reason: string }[];
    stale: { name: string; version: string }[];
    unresolvable: { path: string; resolved: string }[];
  }

  /**
   * Runs the gate as a subprocess. Deliberately ASYNC: the fake registry lives
   * in this process, so a synchronous spawn would block the event loop that has
   * to serve the subprocess's requests, and both sides would wait each other out.
   */
  function run(
    args: string[],
    script = gate,
  ): Promise<{ status: number; stdout: string; stderr: string }> {
    return new Promise((done) => {
      execFile(
        process.execPath,
        [script, ...args],
        { cwd: repoRoot, encoding: 'utf8' },
        (error, stdout, stderr) => {
          const status = error ? ((error as { code?: number }).code ?? 1) : 0;
          done({ status, stdout, stderr });
        },
      );
    });
  }

  /** Audit `lockPath` against the fake registry and parse the JSON report. */
  async function audit(
    lockPath: string,
    extra: string[] = [],
    script = gate,
  ): Promise<{ status: number; report: Report; stderr: string }> {
    const { status, stdout, stderr } = await run(
      [
        '--all',
        '--no-cache',
        '--json',
        '--lockfile',
        lockPath,
        '--registry',
        registryUrl,
        ...extra,
      ],
      script,
    );
    return { status, report: stdout ? (JSON.parse(stdout) as Report) : ({} as Report), stderr };
  }

  it('passes when every resolved version is older than the window', async () => {
    packuments = { 'old-pkg': { '1.0.0': daysAgo(400) }, 'also-old': { '2.3.4': daysAgo(8) } };
    const lockPath = writeLockfile({
      'node_modules/old-pkg': dep('old-pkg', '1.0.0'),
      'node_modules/also-old': dep('also-old', '2.3.4'),
    });

    const { status, report } = await audit(lockPath);
    expect(status).toBe(0);
    expect(report.checked).toBe(2);
    expect(report.tooYoung).toEqual([]);
  });

  it('fails with exit 1 when a version is younger than the window', async () => {
    packuments = { safe: { '1.0.0': daysAgo(90) }, hijacked: { '4.17.22': daysAgo(0.2) } };
    const lockPath = writeLockfile({
      'node_modules/safe': dep('safe', '1.0.0'),
      'node_modules/hijacked': dep('hijacked', '4.17.22'),
    });

    const { status, report } = await audit(lockPath);
    expect(status).toBe(1);
    expect(report.tooYoung.map((item) => `${item.name}@${item.version}`)).toEqual([
      'hijacked@4.17.22',
    ]);
  });

  it('catches a version that is young by hours, not just by days', async () => {
    // The realistic case: a takeover release adopted the same afternoon.
    packuments = { fresh: { '1.2.3': daysAgo(6.9) } };
    const lockPath = writeLockfile({ 'node_modules/fresh': dep('fresh', '1.2.3') });

    expect((await audit(lockPath)).status).toBe(1);
  });

  it('honors --min-age-days in both directions', async () => {
    packuments = { middling: { '1.0.0': daysAgo(10) } };
    const lockPath = writeLockfile({ 'node_modules/middling': dep('middling', '1.0.0') });

    expect((await audit(lockPath, ['--min-age-days', '7'])).status).toBe(0);
    expect((await audit(lockPath, ['--min-age-days', '30'])).status).toBe(1);
  });

  it('flags a version the registry cannot date rather than passing it', async () => {
    // An unpublish/republish leaves a version with no time entry. "We cannot
    // date it" must never read as "it is old enough".
    packuments = { mystery: { '9.9.9': daysAgo(500) } };
    const lockPath = writeLockfile({ 'node_modules/mystery': dep('mystery', '1.0.0') });

    const { status, report } = await audit(lockPath);
    expect(status).toBe(1);
    expect(report.undatable).toHaveLength(1);
    expect(report.undatable[0].name).toBe('mystery');
  });

  it('exits 2, not 1, when the registry cannot be reached', async () => {
    // The single most important property: an infrastructure failure must be
    // distinguishable from a clean pass, or a broken gate looks like a green one.
    const lockPath = writeLockfile({ 'node_modules/whatever': dep('whatever', '1.0.0') });
    const { status, stderr } = await run([
      '--all',
      '--no-cache',
      '--lockfile',
      lockPath,
      '--registry',
      'http://127.0.0.1:1',
    ]);

    expect(status).toBe(2);
    expect(stderr).toContain('cannot be proven');
  });

  it('checks transitive and dev dependencies, not just top-level ones', async () => {
    // Takeovers land in the deep transitive tail; that is the whole point.
    packuments = {
      top: { '1.0.0': daysAgo(100) },
      nested: { '0.0.1': daysAgo(1) },
    };
    const lockPath = writeLockfile({
      'node_modules/top': dep('top', '1.0.0'),
      'node_modules/top/node_modules/nested': { ...dep('nested', '0.0.1'), dev: true },
    });

    const { status, report } = await audit(lockPath);
    expect(status).toBe(1);
    expect(report.tooYoung[0].name).toBe('nested');
  });

  it('skips workspace links and bundled entries, which have no publish time', async () => {
    packuments = { real: { '1.0.0': daysAgo(50) } };
    const lockPath = writeLockfile({
      'packages/core': { name: '@bendyline/squisq', version: '1.0.0' },
      'node_modules/@bendyline/squisq': { resolved: 'packages/core', link: true },
      'node_modules/real': dep('real', '1.0.0'),
      'node_modules/real/node_modules/bundled': { ...dep('bundled', '0.1.0'), inBundle: true },
    });

    const { status, report } = await audit(lockPath);
    expect(status).toBe(0);
    expect(report.checked).toBe(1);
  });

  it('surfaces non-registry resolutions instead of dropping them', async () => {
    packuments = { real: { '1.0.0': daysAgo(50) } };
    const lockPath = writeLockfile({
      'node_modules/real': dep('real', '1.0.0'),
      'node_modules/from-git': {
        version: '1.0.0',
        resolved: 'git+ssh://git@github.com/someone/thing.git#abc123',
      },
    });

    const { report } = await audit(lockPath);
    expect(report.unresolvable).toHaveLength(1);
    expect(report.unresolvable[0].path).toBe('node_modules/from-git');
  });

  it('exempts an EXCEPTIONS entry and reports one that is no longer needed', async () => {
    // Run a copy with EXCEPTIONS populated: the committed array must stay empty
    // unless an urgent bump is actually in flight.
    const patched = join(workDir, 'gate-with-exceptions.mjs');
    writeFileSync(
      patched,
      source.replace(
        'const EXCEPTIONS = [];',
        'const EXCEPTIONS = [' +
          "{ name: 'urgent', version: '1.0.1', reason: 'CVE-0000-0000, diff reviewed' }," +
          "{ name: 'gone', version: '2.0.0', reason: 'no longer installed' }];",
      ),
    );

    packuments = { urgent: { '1.0.1': daysAgo(0.1) }, other: { '1.0.0': daysAgo(0.1) } };
    const lockPath = writeLockfile({
      'node_modules/urgent': dep('urgent', '1.0.1'),
      'node_modules/other': dep('other', '1.0.0'),
    });

    const { status, report } = await audit(lockPath, [], patched);
    expect(report.exempted.map((item) => item.name)).toEqual(['urgent']);
    expect(report.stale.map((item) => item.name)).toEqual(['gone']);
    // The exemption is scoped to its own name@version, never a blanket pass.
    expect(status).toBe(1);
    expect(report.tooYoung.map((item) => item.name)).toEqual(['other']);
  });

  it('applies an exception only to the exact version it names', async () => {
    const patched = join(workDir, 'gate-version-pinned.mjs');
    writeFileSync(
      patched,
      source.replace(
        'const EXCEPTIONS = [];',
        "const EXCEPTIONS = [{ name: 'urgent', version: '1.0.1', reason: 'reviewed' }];",
      ),
    );

    packuments = { urgent: { '1.0.2': daysAgo(0.1) } };
    const lockPath = writeLockfile({ 'node_modules/urgent': dep('urgent', '1.0.2') });

    const { status, report } = await audit(lockPath, [], patched);
    expect(status).toBe(1);
    expect(report.tooYoung.map((item) => `${item.name}@${item.version}`)).toEqual(['urgent@1.0.2']);
  });

  it('refuses --lockfile without --all, which would compare against the wrong base', async () => {
    const lockPath = writeLockfile({}, 'lonely-lock.json');
    const { status, stderr } = await run(['--lockfile', lockPath]);
    expect(status).toBe(2);
    expect(stderr).toContain('requires --all');
  });

  it('rejects an unknown flag rather than silently checking nothing', async () => {
    const { status } = await run(['--all', '--defintely-not-a-flag']);
    expect(status).toBe(2);
  });

  it('keeps every committed exception pinned to an exact version with a reason', async () => {
    // Structural guard on the real script: an exception without a version pin
    // would exempt a whole package forever.
    const match = source.match(/const EXCEPTIONS = \[([\s\S]*?)\];/);
    expect(match, 'EXCEPTIONS array not found in the gate script').toBeTruthy();

    const body = match![1];
    const names = [...body.matchAll(/name:\s*'/g)].length;
    const versions = [...body.matchAll(/version:\s*'/g)].length;
    const reasons = [...body.matchAll(/reason:\s*[`']/g)].length;
    expect(versions).toBe(names);
    expect(reasons).toBe(names);
  });
});
