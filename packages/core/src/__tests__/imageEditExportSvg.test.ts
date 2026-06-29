import { describe, it, expect } from 'vitest';
import { buildSvgString } from '../imageEdit/export';
import { createEmptyImageEditDoc, addLayer } from '../imageEdit/state';
import { MemoryContentContainer } from '../storage/ContentContainer';
import type { ImageEditLayer } from '../schemas/ImageEditDoc';

const container = new MemoryContentContainer();

describe('buildSvgString — path (drawing shape) layers', () => {
  it('renders a named shape (shapeKind) as a <path>, deriving d from the box', async () => {
    let doc = createEmptyImageEditDoc(200, 200);
    const diamond: ImageEditLayer = {
      id: 'p1',
      type: 'path',
      position: { x: 10, y: 20, width: 100, height: 80 },
      content: {
        d: 'M 0 0',
        shapeKind: 'diamond',
        fill: '#3399ff',
        stroke: '#1a4d80',
        strokeWidth: 2,
      },
    };
    doc = addLayer(doc, diamond);

    const svg = await buildSvgString(doc, container);
    expect(svg).toContain('<path');
    expect(svg).toContain('fill="#3399ff"');
    expect(svg).toContain('stroke="#1a4d80"');
    // A diamond inscribed in [10,20,100,80] starts at the top-center (60,20).
    expect(svg).toContain('d="M 60 20');
    // The seed `d="M 0 0"` must NOT survive — geometry is re-derived.
    expect(svg).not.toContain('d="M 0 0"');
  });

  it('renders an arrow path with an end marker def', async () => {
    let doc = createEmptyImageEditDoc(200, 200);
    const arrow: ImageEditLayer = {
      id: 'a1',
      type: 'path',
      position: { x: 0, y: 0, width: 100, height: 100 },
      content: {
        d: 'M 0 0 L 100 100',
        stroke: '#000000',
        strokeWidth: 2,
        fill: 'none',
        endMarker: 'arrow',
      },
    };
    doc = addLayer(doc, arrow);

    const svg = await buildSvgString(doc, container);
    expect(svg).toContain('<marker id="marker-end-a1"');
    expect(svg).toContain('marker-end="url(#marker-end-a1)"');
    expect(svg).toContain('fill="none"');
  });

  it('still renders native rect/circle/line shape layers', async () => {
    let doc = createEmptyImageEditDoc(100, 100);
    doc = addLayer(doc, {
      id: 's1',
      type: 'shape',
      position: { x: 5, y: 5, width: 40, height: 30 },
      content: { shape: 'rect', fill: '#fff', borderRadius: 4 },
    });
    const svg = await buildSvgString(doc, container);
    expect(svg).toContain('<rect x="5" y="5" width="40" height="30"');
    expect(svg).toContain('rx="4"');
  });
});
