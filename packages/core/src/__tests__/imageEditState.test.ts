import { describe, it, expect } from 'vitest';
import {
  createEmptyImageEditDoc,
  addLayer,
  removeLayer,
  reorderLayer,
  updateLayer,
  setCanvas,
} from '../imageEdit/state';
import type { ImageEditLayer } from '../schemas/ImageEditDoc';

function textLayer(id: string, text = 'hi'): ImageEditLayer {
  return {
    id,
    type: 'text',
    position: { x: 0, y: 0, width: 100, height: 30 },
    content: { text, style: { fontSize: 16, color: '#000' } },
  };
}

describe('imageEdit/state helpers', () => {
  it('createEmptyImageEditDoc seeds canvas + meta', () => {
    const doc = createEmptyImageEditDoc(800, 600, { sourcePath: 'src.png' });
    expect(doc.version).toBe(1);
    expect(doc.canvas).toEqual({ width: 800, height: 600, background: 'transparent' });
    expect(doc.layers).toEqual([]);
    expect(doc.meta?.sourcePath).toBe('src.png');
    expect(doc.meta?.createdAt).toBeDefined();
    expect(doc.meta?.updatedAt).toBeDefined();
  });

  it('addLayer appends and assigns id when missing', () => {
    let doc = createEmptyImageEditDoc(100, 100);
    doc = addLayer(doc, textLayer('a'));
    doc = addLayer(doc, { ...textLayer(''), id: '' });
    expect(doc.layers).toHaveLength(2);
    expect(doc.layers[0]!.id).toBe('a');
    expect(doc.layers[1]!.id).toMatch(/^layer-/);
  });

  it('removeLayer drops by id, no-op when missing', () => {
    let doc = addLayer(createEmptyImageEditDoc(100, 100), textLayer('a'));
    doc = addLayer(doc, textLayer('b'));
    const after = removeLayer(doc, 'a');
    expect(after.layers.map((l) => l.id)).toEqual(['b']);
    const noop = removeLayer(after, 'missing');
    expect(noop).toBe(after);
  });

  it('reorderLayer moves and clamps index', () => {
    let doc = createEmptyImageEditDoc(100, 100);
    for (const id of ['a', 'b', 'c']) doc = addLayer(doc, textLayer(id));
    const moved = reorderLayer(doc, 'a', 99);
    expect(moved.layers.map((l) => l.id)).toEqual(['b', 'c', 'a']);
    const moved2 = reorderLayer(moved, 'a', -10);
    expect(moved2.layers.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('updateLayer shallow-merges by id', () => {
    let doc = addLayer(createEmptyImageEditDoc(100, 100), textLayer('a'));
    doc = updateLayer(doc, 'a', { name: 'Title', opacity: 0.5 });
    expect(doc.layers[0]!.name).toBe('Title');
    expect(doc.layers[0]!.opacity).toBe(0.5);
  });

  it('setCanvas replaces canvas', () => {
    const doc = setCanvas(createEmptyImageEditDoc(100, 100), {
      width: 200,
      height: 300,
      background: '#fff',
    });
    expect(doc.canvas).toEqual({ width: 200, height: 300, background: '#fff' });
  });
});
