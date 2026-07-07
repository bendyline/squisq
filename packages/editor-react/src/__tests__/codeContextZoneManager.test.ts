/**
 * @vitest-environment jsdom
 *
 * Exercises the zone manager against a fake Monaco editor with a recording
 * changeViewZones accessor — batch semantics, delegate mutation on move and
 * height changes, model-change rebuild, and dispose cleanup.
 */
import { describe, expect, it, vi } from 'vitest';
import type { editor as MonacoEditorNs } from 'monaco-editor';
import { CodeContextZoneManager } from '../codeContext/CodeContextZoneManager';

type Zone = MonacoEditorNs.IViewZone & { ordinal?: number };

function fakeEditor() {
  const zones = new Map<string, Zone>();
  const layoutCalls: string[] = [];
  let counter = 0;
  let batches = 0;
  let modelCb: (() => void) | null = null;
  const accessor = {
    addZone: (zone: Zone) => {
      const id = `z${++counter}`;
      zones.set(id, zone);
      return id;
    },
    removeZone: (id: string) => {
      zones.delete(id);
    },
    layoutZone: (id: string) => {
      layoutCalls.push(id);
    },
  };
  const editor = {
    changeViewZones: (cb: (a: typeof accessor) => void) => {
      batches++;
      cb(accessor);
    },
    onDidChangeModel: (cb: () => void) => {
      modelCb = cb;
      return { dispose: vi.fn() };
    },
  } as unknown as MonacoEditorNs.IStandaloneCodeEditor;
  return {
    editor,
    zones,
    layoutCalls,
    get batches() {
      return batches;
    },
    fireModelChange: () => modelCb?.(),
  };
}

describe('CodeContextZoneManager', () => {
  it('creates zones above the anchor line in one batch, with dom nodes', () => {
    const fake = fakeEditor();
    const mgr = new CodeContextZoneManager(fake.editor);
    mgr.sync([
      { id: 'file', line: 0, ordinal: 0 },
      { id: 'foo@10', line: 10, ordinal: 1 },
    ]);
    expect(fake.batches).toBe(1);
    expect(fake.zones.size).toBe(2);
    const list = [...fake.zones.values()];
    expect(list.map((z) => z.afterLineNumber)).toEqual([0, 9]);
    expect(list.map((z) => z.ordinal)).toEqual([0, 1]);
    expect(list.every((z) => z.suppressMouseDown)).toBe(true);
    expect(mgr.getDomNode('foo@10')?.className).toBe('squisq-ccx-zone');
  });

  it('sync with no changes performs no batch', () => {
    const fake = fakeEditor();
    const mgr = new CodeContextZoneManager(fake.editor);
    mgr.sync([{ id: 'a', line: 3, ordinal: 1 }]);
    mgr.sync([{ id: 'a', line: 3, ordinal: 1 }]);
    expect(fake.batches).toBe(1);
  });

  it('moves mutate the delegate and layoutZone — dom node survives', () => {
    const fake = fakeEditor();
    const mgr = new CodeContextZoneManager(fake.editor);
    mgr.sync([{ id: 'a', line: 3, ordinal: 1 }]);
    const nodeBefore = mgr.getDomNode('a');
    mgr.sync([{ id: 'a', line: 8, ordinal: 1 }]);
    expect(fake.zones.size).toBe(1);
    expect([...fake.zones.values()][0]!.afterLineNumber).toBe(7);
    expect(fake.layoutCalls.length).toBe(1);
    expect(mgr.getDomNode('a')).toBe(nodeBefore);
  });

  it('setHeight mutates heightInPx and lays out; sub-pixel deltas are ignored', () => {
    const fake = fakeEditor();
    const mgr = new CodeContextZoneManager(fake.editor);
    mgr.sync([{ id: 'a', line: 3, ordinal: 1 }]);
    mgr.setHeight('a', 120);
    expect([...fake.zones.values()][0]!.heightInPx).toBe(120);
    expect(fake.layoutCalls.length).toBe(1);
    mgr.setHeight('a', 119.5); // ceils back to 120 — no relayout
    expect(fake.layoutCalls.length).toBe(1);
  });

  it('a model change drops bookkeeping; the next sync recreates zones', () => {
    const fake = fakeEditor();
    const mgr = new CodeContextZoneManager(fake.editor);
    const onChange = vi.fn();
    mgr.onDidChangeZones(onChange);
    mgr.sync([{ id: 'a', line: 3, ordinal: 1 }]);
    fake.fireModelChange();
    expect(onChange).toHaveBeenCalledTimes(2); // sync + model change
    expect(mgr.getDomNode('a')).toBeUndefined();
    mgr.sync([{ id: 'a', line: 3, ordinal: 1 }]);
    expect(mgr.getDomNode('a')).toBeDefined();
  });

  it('dispose removes every zone and goes inert', () => {
    const fake = fakeEditor();
    const mgr = new CodeContextZoneManager(fake.editor);
    mgr.sync([
      { id: 'a', line: 1, ordinal: 1 },
      { id: 'b', line: 2, ordinal: 2 },
    ]);
    mgr.dispose();
    expect(fake.zones.size).toBe(0);
    mgr.sync([{ id: 'c', line: 3, ordinal: 1 }]);
    expect(fake.zones.size).toBe(0);
  });
});
