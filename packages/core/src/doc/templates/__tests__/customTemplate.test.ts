/**
 * makeCustomTemplateFn — verifies a CustomTemplateDefinition expands
 * correctly via the standard template function signature and that
 * `%`-based positions resolve correctly across viewport presets.
 */

import { describe, it, expect } from 'vitest';
import { makeCustomTemplateFn } from '../customTemplate';
import type { CustomTemplateDefinition } from '../../../schemas/CustomTemplates.js';
import type { Block, TextLayer } from '../../../schemas/Doc.js';
import type { RawLayersInput, TemplateContext } from '../../../schemas/BlockTemplates.js';
import { createTemplateContext } from '../../../schemas/BlockTemplates.js';
import { DEFAULT_THEME } from '../../../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS, type ViewportConfig } from '../../../schemas/Viewport.js';

function defn(layers: TextLayer[]): CustomTemplateDefinition {
  return {
    name: 'hero',
    label: 'Hero',
    viewport: { width: 1920, height: 1080 },
    layers,
  };
}

function makeContext(
  block: Block,
  viewport: ViewportConfig = VIEWPORT_PRESETS.landscape,
): TemplateContext {
  const ctx = createTemplateContext(DEFAULT_THEME, 0, 1, viewport);
  ctx.block = block;
  return ctx;
}

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: 'b',
    startTime: 0,
    duration: 1,
    audioSegment: 0,
    title: 'Welcome',
    template: 'hero',
    ...overrides,
  };
}

function makeInput(): RawLayersInput {
  return {
    id: 'b',
    template: 'layout',
    duration: 1,
    audioSegment: 0,
  };
}

describe('makeCustomTemplateFn', () => {
  it('substitutes the block title into a layer carrying {title}', () => {
    const fn = makeCustomTemplateFn(
      defn([
        {
          id: 't',
          type: 'text',
          position: { x: '10%', y: '20%', width: '80%', height: '15%' },
          content: { text: 'Hello, {title}!', style: { fontSize: 48, color: '#000' } },
        },
      ]),
    );
    const ctx = makeContext(makeBlock({ title: 'World' }));
    const layers = fn(makeInput(), ctx);
    expect(layers).toHaveLength(1);
    expect((layers[0] as TextLayer).content.text).toBe('Hello, World!');
  });

  it('returns layers unchanged when context.block is missing', () => {
    const fn = makeCustomTemplateFn(
      defn([
        {
          id: 't',
          type: 'text',
          position: { x: '0%', y: '0%', width: '100%', height: '10%' },
          content: { text: '{title}', style: { fontSize: 24, color: '#000' } },
        },
      ]),
    );
    const ctx = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
    const layers = fn(makeInput(), ctx);
    expect((layers[0] as TextLayer).content.text).toBe('{title}');
  });

  it('preserves %-based positions verbatim — they resolve at SSR render time', () => {
    const fn = makeCustomTemplateFn(
      defn([
        {
          id: 't',
          type: 'text',
          position: { x: '10%', y: '20%', width: '80%' },
          content: { text: 'static', style: { fontSize: 24, color: '#000' } },
        },
      ]),
    );

    // Landscape: 1920×1080
    const landscapeLayers = fn(makeInput(), makeContext(makeBlock(), VIEWPORT_PRESETS.landscape));
    expect(landscapeLayers[0].position.x).toBe('10%');

    // Portrait: 1080×1920
    const portraitLayers = fn(makeInput(), makeContext(makeBlock(), VIEWPORT_PRESETS.portrait));
    expect(portraitLayers[0].position.x).toBe('10%');

    // Square: 1080×1080
    const squareLayers = fn(makeInput(), makeContext(makeBlock(), VIEWPORT_PRESETS.square));
    expect(squareLayers[0].position.x).toBe('10%');

    // The positions stay as `%`-strings — the SSR layer renderer (not
    // this function) is responsible for resolving them into pixels
    // against the target viewport. We verify the function doesn't
    // perturb authoring intent.
  });

  it('round-trips multiple tokens in one definition', () => {
    const fn = makeCustomTemplateFn(
      defn([
        {
          id: 'title',
          type: 'text',
          position: { x: '5%', y: '5%', width: '90%', height: '20%' },
          content: { text: '{title}', style: { fontSize: 72, color: '#000' } },
        },
        {
          id: 'body',
          type: 'text',
          position: { x: '5%', y: '30%', width: '90%', height: '60%' },
          content: { text: '{content}', style: { fontSize: 32, color: '#333' } },
        },
      ]),
    );
    const ctx = makeContext(
      makeBlock({
        title: 'Welcome',
        contents: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'A small editor for big ideas.' }],
          },
        ] as any,
      }),
    );
    const layers = fn(makeInput(), ctx);
    expect((layers[0] as TextLayer).content.text).toBe('Welcome');
    expect((layers[1] as TextLayer).content.text).toBe('A small editor for big ideas.');
  });
});
