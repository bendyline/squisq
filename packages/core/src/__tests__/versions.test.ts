import { describe, expect, it, beforeEach } from 'vitest';
import { MemoryContentContainer } from '../storage/ContentContainer';
import {
  DocumentVersionManager,
  VERSIONS_PREFIX,
  buildVersionPath,
  coalesceVersions,
  formatVersionTimestamp,
  getDocBasename,
  listVersions,
  parseVersionPath,
  parseVersionTimestamp,
  pruneVersions,
  readVersion,
  revertToVersion,
  saveVersion,
} from '../versions';

const decoder = new TextDecoder();

async function readUtf8(c: MemoryContentContainer, path: string): Promise<string | null> {
  const data = await c.readFile(path);
  return data ? decoder.decode(data) : null;
}

describe('formatVersionTimestamp / parseVersionTimestamp', () => {
  it('round-trips to second precision', () => {
    const d = new Date(Date.UTC(2026, 3, 30, 15, 20, 30));
    const stamp = formatVersionTimestamp(d);
    expect(stamp).toBe('20260430T152030Z');
    const parsed = parseVersionTimestamp(stamp);
    expect(parsed?.getTime()).toBe(d.getTime());
  });

  it('returns null for invalid input', () => {
    expect(parseVersionTimestamp('not-a-stamp')).toBeNull();
    expect(parseVersionTimestamp('20260430T152030')).toBeNull(); // missing Z
    expect(parseVersionTimestamp('2026-04-30T15:20:30Z')).toBeNull(); // wrong format
  });

  it('orders chronologically when sorted lexicographically', () => {
    const a = formatVersionTimestamp(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)));
    const b = formatVersionTimestamp(new Date(Date.UTC(2026, 0, 1, 0, 0, 1)));
    const c = formatVersionTimestamp(new Date(Date.UTC(2026, 5, 15, 12, 0, 0)));
    expect([c, a, b].sort()).toEqual([a, b, c]);
  });
});

describe('paths', () => {
  it('getDocBasename strips folder + extension', () => {
    expect(getDocBasename('index.md')).toBe('index');
    expect(getDocBasename('subdir/foo.md')).toBe('foo');
    expect(getDocBasename('a/b/c/longname.md')).toBe('longname');
    expect(getDocBasename('noext')).toBe('noext');
  });

  it('buildVersionPath round-trips through parseVersionPath', () => {
    const d = new Date(Date.UTC(2026, 3, 30, 15, 20, 30));
    const p = buildVersionPath('index', d);
    expect(p).toBe(`${VERSIONS_PREFIX}index.20260430T152030Z.md`);
    const parsed = parseVersionPath(p);
    expect(parsed).not.toBeNull();
    expect(parsed!.basename).toBe('index');
    expect(parsed!.timestamp.getTime()).toBe(d.getTime());
    expect(parsed!.collision).toBe(0);
  });

  it('buildVersionPath / parseVersionPath handle collision suffix', () => {
    const d = new Date(Date.UTC(2026, 3, 30, 15, 20, 30));
    const p1 = buildVersionPath('index', d, 1);
    expect(p1).toBe(`${VERSIONS_PREFIX}index.20260430T152030Z-2.md`);
    const parsed = parseVersionPath(p1);
    expect(parsed?.collision).toBe(1);
  });

  it('parseVersionPath returns null for non-version files', () => {
    expect(parseVersionPath('index.md')).toBeNull();
    expect(parseVersionPath('.versions/notes.txt')).toBeNull();
    expect(parseVersionPath('.versions/index.invalidstamp.md')).toBeNull();
    expect(parseVersionPath('.versions/index.20260430T152030Z-1.md')).toBeNull(); // suffix must be >= 2
  });
});

describe('saveVersion', () => {
  let container: MemoryContentContainer;

  beforeEach(() => {
    container = new MemoryContentContainer();
  });

  it('returns no-document when container has no markdown', async () => {
    const result = await saveVersion(container);
    expect(result.saved).toBe(false);
    expect(result.reason).toBe('no-document');
  });

  it('returns empty when document content is empty', async () => {
    await container.writeDocument('', 'index.md');
    const result = await saveVersion(container);
    expect(result.saved).toBe(false);
    expect(result.reason).toBe('empty');
  });

  it('writes a snapshot to .versions/ on first save', async () => {
    await container.writeDocument('# hello', 'index.md');
    const now = new Date(Date.UTC(2026, 3, 30, 15, 20, 30));
    const result = await saveVersion(container, { now });

    expect(result.saved).toBe(true);
    expect(result.reason).toBe('saved');
    expect(result.version?.path).toBe(`${VERSIONS_PREFIX}index.20260430T152030Z.md`);
    expect(result.version?.basename).toBe('index');
    expect(await readUtf8(container, result.version!.path)).toBe('# hello');
  });

  it('returns unchanged on identical second save', async () => {
    await container.writeDocument('# hello', 'index.md');
    await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 15, 20, 30)) });
    const result = await saveVersion(container, {
      now: new Date(Date.UTC(2026, 3, 30, 15, 20, 31)),
    });
    expect(result.saved).toBe(false);
    expect(result.reason).toBe('unchanged');
    const all = await listVersions(container);
    expect(all).toHaveLength(1);
  });

  it('writes again when content changes', async () => {
    await container.writeDocument('# hello', 'index.md');
    const r1 = await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 15, 20, 30)) });
    await container.writeDocument('# hello world', 'index.md');
    const r2 = await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 15, 20, 31)) });

    expect(r1.saved).toBe(true);
    expect(r2.saved).toBe(true);
    expect(r1.version?.path).not.toBe(r2.version?.path);
    expect(await listVersions(container)).toHaveLength(2);
  });

  it('force: true writes despite equality', async () => {
    await container.writeDocument('# hello', 'index.md');
    await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 15, 20, 30)) });
    const r = await saveVersion(container, {
      force: true,
      now: new Date(Date.UTC(2026, 3, 30, 15, 20, 31)),
    });
    expect(r.saved).toBe(true);
    expect(await listVersions(container)).toHaveLength(2);
  });

  it('appends a collision suffix when two saves land on the same UTC second', async () => {
    await container.writeDocument('# hello', 'index.md');
    const now = new Date(Date.UTC(2026, 3, 30, 15, 20, 30));
    const r1 = await saveVersion(container, { now });
    // Mutate doc and force-save in the same second.
    await container.writeDocument('# hello v2', 'index.md');
    const r2 = await saveVersion(container, { now });

    expect(r1.version?.path).toBe(`${VERSIONS_PREFIX}index.20260430T152030Z.md`);
    expect(r2.version?.path).toBe(`${VERSIONS_PREFIX}index.20260430T152030Z-2.md`);
  });

  it('content option overrides container.readDocument()', async () => {
    await container.writeDocument('# stored', 'index.md');
    const r = await saveVersion(container, {
      content: '# override',
      now: new Date(Date.UTC(2026, 3, 30, 15, 20, 30)),
    });
    expect(r.saved).toBe(true);
    expect(await readUtf8(container, r.version!.path)).toBe('# override');
  });

  it('basename option overrides the derived basename', async () => {
    await container.writeDocument('# hi', 'index.md');
    const r = await saveVersion(container, {
      basename: 'custom',
      now: new Date(Date.UTC(2026, 3, 30, 15, 20, 30)),
    });
    expect(r.version?.path).toBe(`${VERSIONS_PREFIX}custom.20260430T152030Z.md`);
  });
});

describe('listVersions', () => {
  let container: MemoryContentContainer;
  beforeEach(() => {
    container = new MemoryContentContainer();
  });

  it('ignores non-matching filenames inside .versions/', async () => {
    await container.writeFile(`${VERSIONS_PREFIX}README.txt`, new TextEncoder().encode('skip me'));
    await container.writeFile(
      `${VERSIONS_PREFIX}index.invalidstamp.md`,
      new TextEncoder().encode('also skip'),
    );
    expect(await listVersions(container)).toEqual([]);
  });

  it('returns newest-first', async () => {
    await container.writeDocument('a', 'index.md');
    await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 10, 0, 0)) });
    await container.writeDocument('b', 'index.md');
    await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 11, 0, 0)) });
    await container.writeDocument('c', 'index.md');
    await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 12, 0, 0)) });

    const versions = await listVersions(container);
    expect(versions.map((v) => v.timestamp.getUTCHours())).toEqual([12, 11, 10]);
  });

  it('basename filter excludes other docs', async () => {
    await container.writeFile(
      `${VERSIONS_PREFIX}foo.20260430T100000Z.md`,
      new TextEncoder().encode('foo'),
    );
    await container.writeFile(
      `${VERSIONS_PREFIX}bar.20260430T100000Z.md`,
      new TextEncoder().encode('bar'),
    );
    expect((await listVersions(container, 'foo')).map((v) => v.basename)).toEqual(['foo']);
  });

  it('orders collision-suffix snapshots newest-first within the same UTC second', async () => {
    // Three saves at the same UTC second produce paths with collisions 0, 1, 2.
    // The lex order of the suffix bytes (`-` < `.`) does not match the write
    // order, so the comparator must use the parsed collision number.
    await container.writeDocument('a', 'index.md');
    const now = new Date(Date.UTC(2026, 3, 30, 15, 20, 30));
    await saveVersion(container, { now });
    await container.writeDocument('b', 'index.md');
    await saveVersion(container, { now });
    await container.writeDocument('c', 'index.md');
    await saveVersion(container, { now });

    const versions = await listVersions(container);
    expect(versions.map((v) => v.collision)).toEqual([2, 1, 0]);
    expect(versions[0]!.path).toBe(`${VERSIONS_PREFIX}index.20260430T152030Z-3.md`);
    expect(versions[2]!.path).toBe(`${VERSIONS_PREFIX}index.20260430T152030Z.md`);
  });

  it('saveVersion dedup compares against the actual newest snapshot after a collision', async () => {
    // Regression: when a collision suffix exists, dedup must read the
    // collision file (the real "latest"), not the earlier no-suffix file.
    await container.writeDocument('first', 'index.md');
    const now = new Date(Date.UTC(2026, 3, 30, 15, 20, 30));
    await saveVersion(container, { now });
    await container.writeDocument('second', 'index.md');
    await saveVersion(container, { now });

    // Latest content on disk is "second"; saving it again should be a no-op.
    const r = await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 15, 20, 31)) });
    expect(r.saved).toBe(false);
    expect(r.reason).toBe('unchanged');
  });
});

describe('readVersion', () => {
  it('accepts both Version object and string path', async () => {
    const container = new MemoryContentContainer();
    await container.writeDocument('# content', 'index.md');
    const r = await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 15, 20, 30)) });
    expect(await readVersion(container, r.version!)).toBe('# content');
    expect(await readVersion(container, r.version!.path)).toBe('# content');
  });

  it('returns null for missing snapshot', async () => {
    const container = new MemoryContentContainer();
    expect(await readVersion(container, '.versions/missing.20260430T100000Z.md')).toBeNull();
  });
});

describe('revertToVersion', () => {
  let container: MemoryContentContainer;
  beforeEach(() => {
    container = new MemoryContentContainer();
  });

  it('writes a snapshot of the current doc before reverting (default)', async () => {
    await container.writeDocument('# v1', 'index.md');
    const r1 = await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 10, 0, 0)) });
    await container.writeDocument('# v2 in flight', 'index.md');

    const result = await revertToVersion(container, r1.version!);
    expect(result.reverted).toBe(true);
    expect(result.snapshotted).not.toBeNull();
    expect(await container.readDocument()).toBe('# v1');
    // We should now have two snapshots: the original + the just-snapshotted v2.
    expect(await listVersions(container)).toHaveLength(2);
  });

  it('snapshotCurrent: false skips the safety snapshot', async () => {
    await container.writeDocument('# v1', 'index.md');
    const r1 = await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 10, 0, 0)) });
    await container.writeDocument('# v2 in flight', 'index.md');

    const result = await revertToVersion(container, r1.version!, { snapshotCurrent: false });
    expect(result.snapshotted).toBeNull();
    expect(await container.readDocument()).toBe('# v1');
    expect(await listVersions(container)).toHaveLength(1);
  });

  it('returns reverted: false for missing snapshot', async () => {
    const result = await revertToVersion(container, '.versions/missing.20260430T100000Z.md');
    expect(result.reverted).toBe(false);
  });
});

describe('pruneVersions', () => {
  let container: MemoryContentContainer;

  async function seed(times: number): Promise<void> {
    for (let i = 0; i < times; i++) {
      await container.writeDocument(`# v${i}`, 'index.md');
      await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 10 + i, 0, 0)) });
    }
  }

  beforeEach(() => {
    container = new MemoryContentContainer();
  });

  it('keep-last-n keeps the n newest', async () => {
    await seed(5);
    const deleted = await pruneVersions(container, { type: 'keep-last-n', n: 3 });
    expect(deleted).toHaveLength(2);
    const remaining = await listVersions(container);
    expect(remaining).toHaveLength(3);
    expect(remaining.map((v) => v.timestamp.getUTCHours())).toEqual([14, 13, 12]);
  });

  it('keep-last-n with n: 0 deletes everything', async () => {
    await seed(3);
    await pruneVersions(container, { type: 'keep-last-n', n: 0 });
    expect(await listVersions(container)).toHaveLength(0);
  });

  it('older-than deletes only items older than the cutoff', async () => {
    await seed(5);
    const cutoff = new Date(Date.UTC(2026, 3, 30, 12, 0, 0));
    const deleted = await pruneVersions(container, { type: 'older-than', date: cutoff });
    // hours 10 and 11 are older than 12 → deleted.
    expect(deleted).toHaveLength(2);
    const remaining = await listVersions(container);
    expect(remaining.map((v) => v.timestamp.getUTCHours())).toEqual([14, 13, 12]);
  });

  it('predicate keeps items the predicate accepts', async () => {
    await seed(4);
    const deleted = await pruneVersions(container, {
      type: 'predicate',
      keep: (v) => v.timestamp.getUTCHours() % 2 === 0,
    });
    // 10 and 12 are even (kept); 11 and 13 are odd (deleted).
    expect(deleted).toHaveLength(2);
    expect((await listVersions(container)).map((v) => v.timestamp.getUTCHours())).toEqual([12, 10]);
  });
});

describe('coalesceVersions', () => {
  it('collapses snapshots within the window', async () => {
    const container = new MemoryContentContainer();
    // Three saves: t=0, t=30s (within window), t=2min (outside window).
    await container.writeDocument('a', 'index.md');
    await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 10, 0, 0)) });
    await container.writeDocument('b', 'index.md');
    await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 10, 0, 30)) });
    await container.writeDocument('c', 'index.md');
    await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 10, 2, 0)) });

    const deleted = await coalesceVersions(container, { windowMs: 60_000 });
    // Walking newest-first: the (10:00:30, 10:00:00) pair is 30s apart
    // (within the window), so 10:00:00 — the older of the two — is dropped.
    // The (10:02:00, 10:00:30) pair is 90s apart, so 10:00:30 survives.
    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.timestamp.getTime()).toBe(Date.UTC(2026, 3, 30, 10, 0, 0));
  });

  it('anchors to the last kept snapshot instead of chaining adjacent pairs', async () => {
    // Regression: four snapshots 30s apart with windowMs: 60_000 should keep
    // the newest plus anything beyond 60s of the anchor (here, t=0). Chaining
    // through deleted entries would erase everything but the newest.
    const container = new MemoryContentContainer();
    const base = Date.UTC(2026, 3, 30, 10, 0, 0);
    await container.writeDocument('a', 'index.md');
    await saveVersion(container, { now: new Date(base) });
    await container.writeDocument('b', 'index.md');
    await saveVersion(container, { now: new Date(base + 30_000) });
    await container.writeDocument('c', 'index.md');
    await saveVersion(container, { now: new Date(base + 60_000) });
    await container.writeDocument('d', 'index.md');
    await saveVersion(container, { now: new Date(base + 90_000) });

    const deleted = await coalesceVersions(container, { windowMs: 60_000 });
    // Anchor=t+90 keeps t+30 dropped (60s ≤ window), keeps t=0 (90s > window
    // from anchor → new anchor). t+60 is also within 60s of t+90 → dropped.
    expect(deleted).toHaveLength(2);
    const remaining = await listVersions(container);
    expect(remaining.map((v) => v.timestamp.getTime() - base)).toEqual([90_000, 0]);
  });
});

describe('DocumentVersionManager', () => {
  it('forwards calls and applies the basename override', async () => {
    const container = new MemoryContentContainer();
    await container.writeDocument('# hi', 'index.md');
    const manager = new DocumentVersionManager(container, { basename: 'custom' });
    const r = await manager.saveVersion({ now: new Date(Date.UTC(2026, 3, 30, 15, 20, 30)) });
    expect(r.version?.path).toBe(`${VERSIONS_PREFIX}custom.20260430T152030Z.md`);

    const list = await manager.listVersions();
    expect(list).toHaveLength(1);

    const content = await manager.readVersion(list[0]!);
    expect(content).toBe('# hi');
  });
});
