import { describe, it, expect } from 'vitest';
import { computeDrawingLayout } from '../doc/templates/drawingLayout.js';
import { drawingBlock } from '../doc/templates/drawingBlock.js';
import { diagramBlock } from '../doc/templates/diagramBlock.js';
import { createTemplateContext } from '../schemas/BlockTemplates.js';
import { DEFAULT_THEME } from '../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../schemas/Viewport.js';
import type { Block, PathLayer } from '../schemas/Doc.js';
import type { DiagramBlockInput } from '../schemas/BlockTemplates.js';

function shape(id: string, template: string, overrides: Record<string, string> = {}): Block {
  return {
    id,
    startTime: 0,
    duration: 0,
    audioSegment: 0,
    template,
    templateOverrides: overrides,
  } as Block;
}

function ctx(children: Block[]) {
  const c = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
  c.children = children;
  return c;
}

describe('drawing shape vocabulary', () => {
  it('recognizes new polygon kinds and aliases', () => {
    const layout = computeDrawingLayout([
      shape('s', 'star', { x: '0', y: '0' }),
      shape('h', 'hexagon', { x: '0', y: '0' }),
      shape('r', 'rhombus', { x: '0', y: '0' }), // alias → diamond
      shape('a', 'rightarrow', { x: '0', y: '0' }), // alias → arrow-right
    ]);
    const kinds = layout.shapes.map((s) => s.kind);
    expect(kinds).toEqual(['star', 'hexagon', 'diamond', 'arrow-right']);
  });

  it('renders a polygon kind as a PathLayer in the block', () => {
    const layers = drawingBlock({ template: 'drawing', id: 'd', duration: 0, audioSegment: 0 }, ctx([
      shape('s', 'star', { x: '10', y: '10', width: '100', height: '100' }),
    ]));
    const star = layers.find((l) => l.id === 'shape-s');
    expect(star?.type).toBe('path');
  });
});

describe('drawing connector semantics', () => {
  function conn(overrides: Record<string, string>) {
    return computeDrawingLayout([
      shape('a', 'rect', { x: '0', y: '0', width: '50', height: '50' }),
      shape('b', 'rect', { x: '0', y: '200', width: '50', height: '50' }),
      shape('c', 'arrow', { from: 'a', to: 'b', ...overrides }),
    ]).connectors[0];
  }

  it('parses end/start markers, line style, and routing', () => {
    expect(conn({ endStyle: 'diamond', startStyle: 'circle', lineStyle: 'dashed', routing: 'orthogonal' })).toMatchObject(
      { endMarker: 'diamond', startMarker: 'circle', dasharray: '8 6', routing: 'orthogonal' },
    );
  });

  it('defaults arrow → end arrow, line → no marker, straight routing', () => {
    expect(conn({})).toMatchObject({ endMarker: 'arrow', startMarker: 'none', routing: 'straight' });
    const line = computeDrawingLayout([
      shape('a', 'rect', { x: '0', y: '0', width: '50', height: '50' }),
      shape('b', 'rect', { x: '0', y: '200', width: '50', height: '50' }),
      shape('l', 'line', { from: 'a', to: 'b' }),
    ]).connectors[0];
    expect(line.endMarker).toBe('none');
  });

  it('emits the marker + dash on the rendered connector PathLayer', () => {
    const layers = drawingBlock({ template: 'drawing', id: 'd', duration: 0, audioSegment: 0 }, ctx([
      shape('a', 'rect', { x: '0', y: '0', width: '50', height: '50' }),
      shape('b', 'rect', { x: '0', y: '200', width: '50', height: '50' }),
      shape('c', 'arrow', { from: 'a', to: 'b', endStyle: 'diamond', lineStyle: 'dashed' }),
    ]));
    const connector = layers.find((l) => l.id === 'connector-c') as PathLayer | undefined;
    expect(connector?.content.endMarker).toBe('diamond');
    expect(connector?.content.dasharray).toBe('8 6');
  });
});

describe('diagram edge styles', () => {
  function node(id: string, x: number, y: number, connectsTo?: string): Block {
    return {
      id,
      startTime: 0,
      duration: 0,
      audioSegment: 0,
      x,
      y,
      ...(connectsTo ? { connectsTo: [{ target: connectsTo }] } : {}),
    } as Block;
  }

  it('applies endStyle and lineStyle to all edges', () => {
    const c = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
    c.children = [node('a', 0, 0, 'b'), node('b', 300, 0)];
    const input: DiagramBlockInput = {
      template: 'diagram',
      id: 'g',
      duration: 0,
      audioSegment: 0,
      endStyle: 'circle',
      lineStyle: 'dashed',
    };
    const layers = diagramBlock(input, c);
    const edge = layers.find((l) => l.id.startsWith('edge-')) as PathLayer | undefined;
    expect(edge?.content.endMarker).toBe('circle');
    expect(edge?.content.dasharray).toBe('8 6');
  });
});
