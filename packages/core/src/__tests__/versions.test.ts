import { describe, expect, it, beforeEach } from 'vitest';
import { MemoryContentContainer, type ContentContainer } from '../storage/ContentContainer';
import { scopeContainer } from '../storage/ScopedContentContainer';
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

  it('rejects basenames that could escape or break the snapshot directory', () => {
    const date = new Date(Date.UTC(2026, 3, 30, 15, 20, 30));
    for (const basename of ['../escape', '..\\escape', 'bad:name', 'CON', 'trailing.']) {
      expect(() => buildVersionPath(basename, date)).toThrow();
    }
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

  it('versions an intentionally empty document', async () => {
    await container.writeDocument('', 'index.md');
    const now = new Date(Date.UTC(2026, 3, 30, 15, 20, 30));
    const result = await saveVersion(container, { now });
    expect(result.saved).toBe(true);
    expect(result.reason).toBe('saved');
    expect(await readUtf8(container, result.version!.path)).toBe('');
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
    expect(await readUtf8(container, '.gitignore')).toBe('.versions/\n');
  });

  it('writes the ignore rule at the root of a scoped *_files sidecar', async () => {
    const parent = new MemoryContentContainer();
    const sidecar = scopeContainer(parent, 'notes_files');
    const now = new Date(Date.UTC(2026, 3, 30, 15, 20, 30));

    const result = await saveVersion(sidecar, {
      basename: 'notes',
      content: '# hello',
      now,
    });

    expect(result.saved).toBe(true);
    expect(await readUtf8(parent, 'notes_files/.gitignore')).toBe('.versions/\n');
    expect(await parent.exists(`notes_files/${result.version!.path}`)).toBe(true);
  });

  it('preserves existing .gitignore rules and does not duplicate the versions rule', async () => {
    await container.writeDocument('# hello', 'index.md');
    await container.writeFile(
      '.gitignore',
      new TextEncoder().encode('generated/\r\n'),
      'text/plain',
    );
    await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 15, 20, 30)) });
    await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 15, 20, 31)) });

    expect(await readUtf8(container, '.gitignore')).toBe('generated/\r\n.versions/\r\n');
  });

  // Committing version history is a legitimate deliberate choice. Appending
  // our rule after a user's `!.versions/` would win under Git's
  // last-match-wins semantics and silently revert that choice.
  it('honours an explicit !.versions/ negation', async () => {
    await container.writeDocument('# hello', 'index.md');
    await container.writeFile(
      '.gitignore',
      new TextEncoder().encode('.versions/\n!.versions/\n'),
      'text/plain',
    );

    await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 15, 20, 30)) });

    expect(await readUtf8(container, '.gitignore')).toBe('.versions/\n!.versions/\n');
  });

  it('honours a bare !.versions/ negation with no prior ignore rule', async () => {
    await container.writeDocument('# hello', 'index.md');
    await container.writeFile(
      '.gitignore',
      new TextEncoder().encode('!.versions/\n'),
      'text/plain',
    );

    await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 15, 20, 30)) });

    expect(await readUtf8(container, '.gitignore')).toBe('!.versions/\n');
  });

  it('backfills .gitignore when an existing snapshot is unchanged', async () => {
    await container.writeDocument('# hello', 'index.md');
    await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 15, 20, 30)) });
    await container.removeFile('.gitignore');

    const result = await saveVersion(container, {
      now: new Date(Date.UTC(2026, 3, 30, 15, 20, 31)),
    });

    expect(result.reason).toBe('unchanged');
    expect(await readUtf8(container, '.gitignore')).toBe('.versions/\n');
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

  it('preserves both contents when saves race for the same timestamp', async () => {
    const now = new Date(Date.UTC(2026, 3, 30, 15, 20, 30));
    const [first, second] = await Promise.all([
      saveVersion(container, { basename: 'index', content: 'A', now }),
      saveVersion(container, { basename: 'index', content: 'B', now }),
    ]);

    expect(first.version?.path).not.toBe(second.version?.path);
    expect(await listVersions(container, 'index')).toHaveLength(2);
    const contents = await Promise.all(
      [first.version!, second.version!].map((version) => readVersion(container, version)),
    );
    expect(new Set(contents)).toEqual(new Set(['A', 'B']));
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
    expect(result.reason).toBe('missing-snapshot');
  });

  it('snapshots the caller-supplied live content, not the stale container doc', async () => {
    // Hosts that keep the live document outside the container (an editor
    // buffer) would otherwise have their unsaved work snapshotted as
    // whatever stale bytes the container happens to hold.
    await container.writeDocument('# v1', 'index.md');
    const r1 = await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 10, 0, 0)) });

    const result = await revertToVersion(container, r1.version!, {
      content: '# unsaved draft only in the editor',
    });

    expect(result.reverted).toBe(true);
    expect(await container.readDocument()).toBe('# v1');
    const snapshot = await readVersion(container, result.snapshotted!);
    expect(snapshot).toBe('# unsaved draft only in the editor');
  });

  it('abandons the revert when there is no current document to snapshot', async () => {
    // The host keeps the live document outside the container, so the
    // container holds snapshots but no primary doc. Snapshotting yields
    // `no-document`, meaning the current state is NOT recoverable —
    // reverting anyway would destroy it, so we must decline.
    const stamp = new Date(Date.UTC(2026, 3, 30, 10, 0, 0));
    const path = buildVersionPath('index', stamp);
    await container.writeFile(path, new TextEncoder().encode('# v1'), 'text/markdown');

    const result = await revertToVersion(container, path);

    expect(result.reverted).toBe(false);
    expect(result.reason).toBe('snapshot-failed');
    expect(await container.readDocument()).toBeNull();
  });

  it('does not overwrite the document when the safety snapshot throws', async () => {
    // A storage failure mid-snapshot must not leave the revert half-done:
    // the in-flight document has to survive.
    await container.writeDocument('# v1', 'index.md');
    const r1 = await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 10, 0, 0)) });
    await container.writeDocument('# v2 in flight', 'index.md');

    // Delegate everything to the real container except snapshot writes,
    // which fail the way a full disk / revoked permission would.
    const realWrite = container.writeFileExclusive.bind(container);
    const failing: ContentContainer = Object.create(container, {
      writeFileExclusive: {
        value: async (
          path: string,
          data: ArrayBuffer | Uint8Array,
          mimeType?: string,
        ): Promise<boolean> => {
          if (path.startsWith(VERSIONS_PREFIX)) throw new Error('disk full');
          return realWrite(path, data, mimeType);
        },
      },
    });

    await expect(revertToVersion(failing, r1.version!)).rejects.toThrow('disk full');
    // The in-flight document is untouched.
    expect(await container.readDocument()).toBe('# v2 in flight');
  });

  it('reverts when the current content already matches the newest snapshot', async () => {
    // `unchanged` is not a failure — the current state is already
    // recoverable, so there is nothing to protect.
    await container.writeDocument('# v1', 'index.md');
    const r1 = await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 10, 0, 0)) });
    await container.writeDocument('# v2', 'index.md');
    await saveVersion(container, { now: new Date(Date.UTC(2026, 3, 30, 11, 0, 0)) });

    const result = await revertToVersion(container, r1.version!);

    expect(result.reverted).toBe(true);
    expect(await container.readDocument()).toBe('# v1');
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

  it('rejects invalid limits without deleting any snapshots', async () => {
    await seed(3);
    for (const n of [-1, Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
      await expect(pruneVersions(container, { type: 'keep-last-n', n })).rejects.toThrow();
      expect(await listVersions(container)).toHaveLength(3);
    }
    await expect(
      pruneVersions(container, { type: 'older-than', date: new Date(Number.NaN) }),
    ).rejects.toThrow();
    expect(await listVersions(container)).toHaveLength(3);
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

  // Retention is per-DOCUMENT. One container can hold several documents'
  // snapshots; applying a policy to the flat list lets a busy document evict
  // a quiet one's history entirely.
  describe('multi-document containers', () => {
    async function saveAt(basename: string, content: string, hour: number): Promise<void> {
      await saveVersion(container, {
        basename,
        content,
        now: new Date(Date.UTC(2026, 3, 30, hour, 0, 0)),
      });
    }

    it('keep-last-n applies its budget per basename', async () => {
      // `notes` has 3 snapshots, all OLDER than `index`'s 2. A flat cap of 2
      // spends the whole budget on `index` and deletes every `notes` snapshot.
      await saveAt('notes', 'n1', 10);
      await saveAt('notes', 'n2', 11);
      await saveAt('notes', 'n3', 12);
      await saveAt('index', 'i1', 13);
      await saveAt('index', 'i2', 14);

      await pruneVersions(container, { type: 'keep-last-n', n: 2 });

      expect(
        (await listVersions(container, 'notes')).map((v) => v.timestamp.getUTCHours()),
      ).toEqual([12, 11]);
      expect(
        (await listVersions(container, 'index')).map((v) => v.timestamp.getUTCHours()),
      ).toEqual([14, 13]);
    });

    it('predicate sees only the document it is deciding about', async () => {
      await saveAt('notes', 'n1', 10);
      await saveAt('index', 'i1', 11);
      await saveAt('index', 'i2', 12);

      const seen = new Map<string, number>();
      await pruneVersions(container, {
        type: 'predicate',
        keep: (v, all) => {
          seen.set(v.basename, all.length);
          return true;
        },
      });

      expect(seen.get('notes')).toBe(1);
      expect(seen.get('index')).toBe(2);
    });

    it('returns deletions newest-first across documents', async () => {
      await saveAt('notes', 'n1', 10);
      await saveAt('index', 'i1', 11);
      await saveAt('notes', 'n2', 12);
      await saveAt('index', 'i2', 13);

      const deleted = await pruneVersions(container, { type: 'keep-last-n', n: 0 });
      expect(deleted.map((v) => v.timestamp.getUTCHours())).toEqual([13, 12, 11, 10]);
    });
  });
});

describe('coalesceVersions', () => {
  it('rejects invalid windows without deleting any snapshots', async () => {
    const container = new MemoryContentContainer();
    await container.writeDocument('a', 'index.md');
    await saveVersion(container);
    await expect(coalesceVersions(container, { windowMs: -1 })).rejects.toThrow();
    expect(await listVersions(container)).toHaveLength(1);
  });

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

  it('never coalesces one document against another document', async () => {
    // Two docs in one container. `notes` has a SINGLE snapshot — it has no
    // adjacent snapshot of its own, so nothing about it can be coalesced.
    // Comparing timestamps across basenames made `index`'s later save (10s
    // apart) collapse `notes`'s only version, destroying that history.
    const container = new MemoryContentContainer();
    const base = Date.UTC(2026, 3, 30, 10, 0, 0);
    await saveVersion(container, { basename: 'notes', content: 'n1', now: new Date(base) });
    await saveVersion(container, {
      basename: 'index',
      content: 'i1',
      now: new Date(base + 10_000),
    });

    const deleted = await coalesceVersions(container, { windowMs: 60_000 });

    expect(deleted).toHaveLength(0);
    expect(await listVersions(container, 'notes')).toHaveLength(1);
    expect(await listVersions(container, 'index')).toHaveLength(1);
  });

  it('interleaved documents coalesce along their own timelines', async () => {
    // index: t=0, t+10s (adjacent, within window → older dropped)
    // notes: t+5s, t+120s (two minutes apart → both kept)
    // A flat walk sees 0/5/10/120 interleaved and collapses across docs.
    const container = new MemoryContentContainer();
    const base = Date.UTC(2026, 3, 30, 10, 0, 0);
    await saveVersion(container, { basename: 'index', content: 'i1', now: new Date(base) });
    await saveVersion(container, { basename: 'notes', content: 'n1', now: new Date(base + 5_000) });
    await saveVersion(container, {
      basename: 'index',
      content: 'i2',
      now: new Date(base + 10_000),
    });
    await saveVersion(container, {
      basename: 'notes',
      content: 'n2',
      now: new Date(base + 120_000),
    });

    const deleted = await coalesceVersions(container, { windowMs: 60_000 });

    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.basename).toBe('index');
    expect(deleted[0]!.timestamp.getTime()).toBe(base);
    expect(
      (await listVersions(container, 'notes')).map((v) => v.timestamp.getTime() - base),
    ).toEqual([120_000, 5_000]);
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
