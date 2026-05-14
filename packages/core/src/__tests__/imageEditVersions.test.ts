import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryContentContainer } from '../storage/ContentContainer';
import { scopeContainer } from '../storage/ScopedContentContainer';
import { createEmptyImageEditDoc, addLayer } from '../imageEdit/state';
import { writeImageEditDoc, readImageEditDoc } from '../imageEdit/persistence';
import {
  saveImageEditVersion,
  listImageEditVersions,
  readImageEditVersion,
  revertToImageEditVersion,
  pruneImageEditVersions,
} from '../imageEdit/versions';
import { ImageEditVersionManager } from '../imageEdit/ImageEditVersionManager';
import type { ImageEditLayer } from '../schemas/ImageEditDoc';

const text = (id: string): ImageEditLayer => ({
  id,
  type: 'text',
  position: { x: 0, y: 0 },
  content: { text: id, style: { fontSize: 16, color: '#000' } },
});

describe('imageEdit/persistence', () => {
  it('round-trips state.json', async () => {
    const sidecar = scopeContainer(new MemoryContentContainer(), 'image_files');
    const doc = addLayer(createEmptyImageEditDoc(640, 480), text('a'));
    await writeImageEditDoc(sidecar, doc);
    const read = await readImageEditDoc(sidecar);
    expect(read?.canvas.width).toBe(640);
    expect(read?.layers).toHaveLength(1);
    expect(read?.layers[0]!.id).toBe('a');
  });

  it('returns null when state.json is missing', async () => {
    const sidecar = scopeContainer(new MemoryContentContainer(), 'sc');
    expect(await readImageEditDoc(sidecar)).toBeNull();
  });

  it('rejects unsupported schema version', async () => {
    const sidecar = scopeContainer(new MemoryContentContainer(), 'sc');
    await sidecar.writeFile(
      'state.json',
      new TextEncoder().encode(
        JSON.stringify({ version: 2, canvas: { width: 1, height: 1 }, layers: [] }),
      ),
    );
    await expect(readImageEditDoc(sidecar)).rejects.toThrow(/unsupported schema version/);
  });
});

describe('imageEdit/versions', () => {
  let parent: MemoryContentContainer;
  let sidecar: ReturnType<typeof scopeContainer>;

  beforeEach(() => {
    parent = new MemoryContentContainer();
    sidecar = scopeContainer(parent, 'image_files');
  });

  it('saves a snapshot when state.json exists', async () => {
    const doc = addLayer(createEmptyImageEditDoc(100, 100), text('a'));
    await writeImageEditDoc(sidecar, doc);
    const result = await saveImageEditVersion(sidecar, { now: new Date('2026-04-01T10:00:00Z') });
    expect(result.saved).toBe(true);
    expect(result.version?.path).toMatch(/^\.versions\/state\.\d{8}T\d{6}Z\.json$/);
    // snapshot is inside the sidecar, visible to the parent under the prefix
    expect(await parent.exists(`image_files/${result.version!.path}`)).toBe(true);
  });

  it('returns no-state when sidecar is empty', async () => {
    const result = await saveImageEditVersion(sidecar);
    expect(result).toEqual({ saved: false, version: null, reason: 'no-state' });
  });

  it('skips saving when content is unchanged', async () => {
    const doc = createEmptyImageEditDoc(100, 100, { now: new Date('2026-01-01') });
    await writeImageEditDoc(sidecar, doc);
    const first = await saveImageEditVersion(sidecar, {
      doc,
      now: new Date('2026-04-01T10:00:00Z'),
    });
    expect(first.saved).toBe(true);
    const second = await saveImageEditVersion(sidecar, {
      doc,
      now: new Date('2026-04-01T10:01:00Z'),
    });
    expect(second).toEqual({ saved: false, version: null, reason: 'unchanged' });
  });

  it('appends a collision suffix when saves land in the same second', async () => {
    const same = new Date('2026-04-01T10:00:00Z');
    const docA = addLayer(createEmptyImageEditDoc(100, 100), text('a'));
    const docB = addLayer(createEmptyImageEditDoc(100, 100), text('b'));
    const r1 = await saveImageEditVersion(sidecar, { doc: docA, now: same });
    const r2 = await saveImageEditVersion(sidecar, { doc: docB, now: same });
    expect(r1.saved).toBe(true);
    expect(r2.saved).toBe(true);
    expect(r1.version!.path).not.toBe(r2.version!.path);
    expect(r2.version!.path).toMatch(/-2\.json$/);
  });

  it('lists versions newest-first', async () => {
    await saveImageEditVersion(sidecar, {
      doc: addLayer(createEmptyImageEditDoc(100, 100), text('a')),
      now: new Date('2026-01-01T00:00:00Z'),
    });
    await saveImageEditVersion(sidecar, {
      doc: addLayer(createEmptyImageEditDoc(100, 100), text('b')),
      now: new Date('2026-02-01T00:00:00Z'),
    });
    const versions = await listImageEditVersions(sidecar);
    expect(versions).toHaveLength(2);
    expect(versions[0]!.timestamp.getUTCFullYear()).toBe(2026);
    expect(versions[0]!.timestamp.getUTCMonth()).toBe(1); // Feb
  });

  it('readImageEditVersion returns the parsed snapshot', async () => {
    const doc = addLayer(createEmptyImageEditDoc(100, 100), text('a'));
    const result = await saveImageEditVersion(sidecar, {
      doc,
      now: new Date('2026-03-01T00:00:00Z'),
    });
    const read = await readImageEditVersion(sidecar, result.version!);
    expect(read?.layers[0]!.id).toBe('a');
  });

  it('revertToImageEditVersion restores state.json and snapshots current first', async () => {
    const docA = addLayer(createEmptyImageEditDoc(100, 100), text('a'));
    await writeImageEditDoc(sidecar, docA);
    const v1 = await saveImageEditVersion(sidecar, {
      doc: docA,
      now: new Date('2026-01-01T00:00:00Z'),
    });

    const docB = addLayer(createEmptyImageEditDoc(100, 100), text('b'));
    await writeImageEditDoc(sidecar, docB);
    const result = await revertToImageEditVersion(sidecar, v1.version!);

    expect(result.reverted).toBe(true);
    expect(result.snapshotted).not.toBeNull();
    const current = await readImageEditDoc(sidecar);
    expect(current?.layers[0]!.id).toBe('a');
  });

  it('pruneImageEditVersions keep-last-n drops older snapshots', async () => {
    for (let i = 0; i < 5; i++) {
      await saveImageEditVersion(sidecar, {
        doc: addLayer(createEmptyImageEditDoc(100, 100), text(`v${i}`)),
        now: new Date(`2026-01-0${i + 1}T00:00:00Z`),
      });
    }
    const deleted = await pruneImageEditVersions(sidecar, { type: 'keep-last-n', n: 2 });
    expect(deleted).toHaveLength(3);
    const remaining = await listImageEditVersions(sidecar);
    expect(remaining).toHaveLength(2);
  });
});

describe('ImageEditVersionManager', () => {
  it('mirrors operations against the captured container', async () => {
    const sidecar = scopeContainer(new MemoryContentContainer(), 'image_files');
    const mgr = new ImageEditVersionManager(sidecar);
    const doc = addLayer(createEmptyImageEditDoc(100, 100), text('a'));
    await writeImageEditDoc(sidecar, doc);
    const r = await mgr.saveVersion({ now: new Date('2026-04-01T00:00:00Z') });
    expect(r.saved).toBe(true);
    expect((await mgr.listVersions())[0]!.path).toBe(r.version!.path);
  });
});
