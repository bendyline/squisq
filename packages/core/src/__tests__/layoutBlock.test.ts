import { describe, it, expect } from 'vitest';
import { layoutBlock } from '../doc/templates/layoutBlock.js';
import { createTemplateContext } from '../schemas/BlockTemplates.js';
import { DEFAULT_THEME } from '../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../schemas/Viewport.js';
import { isContainerTemplate } from '../doc/templates/index.js';
import { parseMarkdown } from '../markdown/parse.js';
import type { Block, Layer, TextLayer } from '../schemas/Doc.js';
import type { RawLayersInput } from '../schemas/BlockTemplates.js';

function child(
  id: string,
  template: string,
  overrides: Record<string, string> = {},
  bodyMd = '',
): Block {
  return {
    id,
    startTime: 0,
    duration: 0,
    audioSegment: 0,
    template,
    templateOverrides: overrides,
    ...(bodyMd ? { contents: parseMarkdown(bodyMd).children } : {}),
  } as Block;
}

function ctxWith(children: Block[]) {
  const ctx = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
  ctx.children = children;
  return ctx;
}

const INPUT: RawLayersInput = { template: 'layout', id: 'lay', duration: 0, audioSegment: 0 };

describe('layoutBlock template', () => {
  it('returns a single hint layer for an empty layout', () => {
    const layers = layoutBlock(INPUT, ctxWith([]));
    expect(layers).toHaveLength(1);
    expect(layers[0].type).toBe('text');
    expect((layers[0] as TextLayer).content.text).toBe('Empty layout');
  });

  it('emits one layer per child, in document order, at absolute positions', () => {
    const layers = layoutBlock(
      INPUT,
      ctxWith([
        child('box-1', 'rectangle', { x: '760', y: '390', width: '400', height: '300' }),
        child('text-1', 'text', { x: '360', y: '380', width: '1200', height: '320' }, 'Welcome'),
      ]),
    );
    expect(layers.map((l) => l.id)).toEqual(['box-1', 'text-1']);
    expect(layers[0].type).toBe('shape');
    expect(layers[1].type).toBe('text');
    expect((layers[1] as TextLayer).content.text).toBe('Welcome');
    expect(layers[0].position).toMatchObject({ x: 760, y: 390 });
  });
});

describe('layout container behavior', () => {
  it('marks layout as a children-consuming container template', () => {
    expect(isContainerTemplate('layout')).toBe(true);
  });

  it('renders a layout block through the template registry (getLayers)', async () => {
    const { getLayers } = await import('../doc/getLayers.js');
    const parent: Block = {
      id: 'lay',
      startTime: 0,
      duration: 0,
      audioSegment: 0,
      template: 'layout',
      children: [
        child('text-1', 'text', { x: '360', y: '380', width: '1200', height: '320' }, 'Title'),
        child('box-1', 'rectangle', { x: '760', y: '390', width: '400', height: '300' }),
      ],
    };
    const layers = getLayers(parent, {});
    const types = new Set(layers.map((l: Layer) => l.type));
    expect(types.has('text')).toBe(true);
    expect(types.has('shape')).toBe(true);
  });
});
