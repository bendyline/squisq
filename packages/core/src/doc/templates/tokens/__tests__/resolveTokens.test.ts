/**
 * resolveTokens — placeholder substitution unit tests.
 *
 * Covers each supported token, the escape syntax, and the edge cases
 * called out in the plan (missing data, out-of-range image index,
 * unknown token left literal).
 */

import { describe, it, expect } from 'vitest';
import { resolveTokens } from '../resolveTokens';
import type { Block, TextLayer, ImageLayer } from '../../../../schemas/Doc.js';

function textLayer(id: string, text: string): TextLayer {
  return {
    id,
    type: 'text',
    position: { x: 0, y: 0, width: 100, height: 50 },
    content: { text, style: { fontSize: 24, color: '#000' } },
  };
}

function imageLayer(id: string, src: string, alt = ''): ImageLayer {
  return {
    id,
    type: 'image',
    position: { x: 0, y: 0, width: 100, height: 100 },
    content: { src, alt },
  };
}

function block(overrides: Partial<Block> = {}): Block {
  return {
    id: 'b',
    startTime: 0,
    duration: 1,
    audioSegment: 0,
    title: 'Block title',
    ...overrides,
  };
}

describe('resolveTokens — TextLayer', () => {
  it('substitutes {title} with block.title', () => {
    const layers = resolveTokens(
      [textLayer('a', 'Hello, {title}!')],
      block({ title: 'World' }),
    );
    const out = layers[0] as TextLayer;
    expect(out.content.text).toBe('Hello, World!');
  });

  it('collapses {title} to empty when block has no title', () => {
    const layers = resolveTokens(
      [textLayer('a', '[{title}]')],
      block({ title: undefined }),
    );
    expect((layers[0] as TextLayer).content.text).toBe('[]');
  });

  it('substitutes {content} from block.contents (plain text of body)', () => {
    const layers = resolveTokens(
      [textLayer('a', 'Body: {content}')],
      block({
        contents: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'Hello there' }],
          },
        ] as any,
      }),
    );
    expect((layers[0] as TextLayer).content.text).toBe('Body: Hello there');
  });

  it('joins multiple paragraphs in {content} with single spaces', () => {
    const layers = resolveTokens(
      [textLayer('a', '{content}')],
      block({
        contents: [
          { type: 'paragraph', children: [{ type: 'text', value: 'First.' }] },
          { type: 'paragraph', children: [{ type: 'text', value: 'Second.' }] },
        ] as any,
      }),
    );
    expect((layers[0] as TextLayer).content.text).toBe('First. Second.');
  });

  it('joins child titles for {children}', () => {
    const layers = resolveTokens(
      [textLayer('a', 'Sections: {children}')],
      block({
        children: [
          block({ id: 'c1', title: 'Alpha' }),
          block({ id: 'c2', title: 'Beta' }),
          block({ id: 'c3', title: 'Gamma' }),
        ],
      }),
    );
    expect((layers[0] as TextLayer).content.text).toBe('Sections: Alpha, Beta, Gamma');
  });

  it('substitutes {image:N} with the Nth image alt text', () => {
    const layers = resolveTokens(
      [textLayer('a', 'Caption: {image:0}')],
      block({
        contents: [
          {
            type: 'paragraph',
            children: [
              { type: 'image', url: '/a.png', alt: 'Alpha image' },
            ],
          },
        ] as any,
      }),
    );
    expect((layers[0] as TextLayer).content.text).toBe('Caption: Alpha image');
  });

  it('preserves {{title}} as literal {title}', () => {
    const layers = resolveTokens(
      [textLayer('a', 'Use {{title}} as a token, or {title} to expand')],
      block({ title: 'My Doc' }),
    );
    expect((layers[0] as TextLayer).content.text).toBe(
      'Use {title} as a token, or My Doc to expand',
    );
  });

  it('leaves unknown tokens literal', () => {
    const layers = resolveTokens(
      [textLayer('a', 'Hello {nope} world')],
      block(),
    );
    expect((layers[0] as TextLayer).content.text).toBe('Hello {nope} world');
  });

  it('substitutes multiple tokens in a single string', () => {
    const layers = resolveTokens(
      [textLayer('a', '{title} — {content}')],
      block({
        title: 'Doc',
        contents: [
          { type: 'paragraph', children: [{ type: 'text', value: 'body' }] },
        ] as any,
      }),
    );
    expect((layers[0] as TextLayer).content.text).toBe('Doc — body');
  });
});

describe('resolveTokens — ImageLayer', () => {
  it('substitutes {image:0} with the Nth image URL in src', () => {
    const layers = resolveTokens(
      [imageLayer('a', '{image:0}')],
      block({
        contents: [
          {
            type: 'paragraph',
            children: [
              { type: 'image', url: '/hero.png', alt: 'hero' },
            ],
          },
        ] as any,
      }),
    );
    expect(layers).toHaveLength(1);
    expect((layers[0] as ImageLayer).content.src).toBe('/hero.png');
  });

  it('drops the layer entirely when the requested image index is out of range', () => {
    const layers = resolveTokens(
      [imageLayer('a', '{image:99}'), imageLayer('b', '/keep.png')],
      block({
        contents: [
          {
            type: 'paragraph',
            children: [{ type: 'image', url: '/one.png', alt: '' }],
          },
        ] as any,
      }),
    );
    expect(layers).toHaveLength(1);
    expect(layers[0].id).toBe('b');
  });

  it('substitutes tokens in the alt text when the src is also a token', () => {
    const layers = resolveTokens(
      [imageLayer('a', '{image:0}', 'Image for {title}')],
      block({
        title: 'My Doc',
        contents: [
          {
            type: 'paragraph',
            children: [{ type: 'image', url: '/x.png', alt: '' }],
          },
        ] as any,
      }),
    );
    const img = layers[0] as ImageLayer;
    expect(img.content.src).toBe('/x.png');
    expect(img.content.alt).toBe('Image for My Doc');
  });

  it('passes through ImageLayer with no token in src', () => {
    const layers = resolveTokens(
      [imageLayer('a', '/static.png')],
      block(),
    );
    expect((layers[0] as ImageLayer).content.src).toBe('/static.png');
  });
});

describe('resolveTokens — other layer types', () => {
  it('passes ShapeLayer / PathLayer through unchanged', () => {
    const shape = {
      id: 's',
      type: 'shape' as const,
      position: { x: 0, y: 0, width: 50, height: 50 },
      content: { shape: 'rect' as const, fill: '#fff' },
    };
    const path = {
      id: 'p',
      type: 'path' as const,
      position: { x: 0, y: 0, width: 100, height: 100 },
      content: { d: 'M 0 0 L 100 100', stroke: '#000' },
    };
    const layers = resolveTokens([shape, path], block());
    expect(layers).toEqual([shape, path]);
  });
});

describe('resolveTokens — purity', () => {
  it('does not mutate the input layers array or the layers themselves', () => {
    const original = textLayer('a', '{title}');
    const before = JSON.stringify(original);
    resolveTokens([original], block({ title: 'X' }));
    expect(JSON.stringify(original)).toBe(before);
  });
});
