/**
 * resolveTokens — placeholder substitution unit tests.
 *
 * Covers each supported token, the escape syntax, and the edge cases
 * called out in the plan (missing data, out-of-range image index,
 * unknown token left literal).
 */

import { describe, it, expect } from 'vitest';
import { resolveTokens, collectListItems } from '../resolveTokens';
import type { Block, TextLayer, ImageLayer } from '../../../../schemas/Doc.js';
import type { CustomTemplateLayer } from '../../../../schemas/CustomTemplates.js';

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
    const layers = resolveTokens([textLayer('a', 'Hello, {title}!')], block({ title: 'World' }));
    const out = layers[0] as TextLayer;
    expect(out.content.text).toBe('Hello, World!');
  });

  it('collapses {title} to empty when block has no title', () => {
    const layers = resolveTokens([textLayer('a', '[{title}]')], block({ title: undefined }));
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
        ],
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
        ],
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
            children: [{ type: 'image', url: '/a.png', alt: 'Alpha image' }],
          },
        ],
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
    const layers = resolveTokens([textLayer('a', 'Hello {nope} world')], block());
    expect((layers[0] as TextLayer).content.text).toBe('Hello {nope} world');
  });

  it('substitutes multiple tokens in a single string', () => {
    const layers = resolveTokens(
      [textLayer('a', '{title} — {content}')],
      block({
        title: 'Doc',
        contents: [{ type: 'paragraph', children: [{ type: 'text', value: 'body' }] }],
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
            children: [{ type: 'image', url: '/hero.png', alt: 'hero' }],
          },
        ],
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
        ],
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
        ],
      }),
    );
    const img = layers[0] as ImageLayer;
    expect(img.content.src).toBe('/x.png');
    expect(img.content.alt).toBe('Image for My Doc');
  });

  it('passes through ImageLayer with no token in src', () => {
    const layers = resolveTokens([imageLayer('a', '/static.png')], block());
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

describe('resolveTokens — {attr:key}', () => {
  it('reads from templateOverrides first, then templateData, then metadata', () => {
    // key present in all three → overrides wins
    const over = resolveTokens(
      [textLayer('a', '{attr:role}')],
      block({
        templateOverrides: { role: 'from-overrides' },
        templateData: { role: 'from-data' },
        metadata: { role: 'from-metadata' },
      }),
    );
    expect((over[0] as TextLayer).content.text).toBe('from-overrides');

    // absent from overrides → templateData wins over metadata
    const data = resolveTokens(
      [textLayer('a', '{attr:role}')],
      block({ templateData: { role: 'from-data' }, metadata: { role: 'from-metadata' } }),
    );
    expect((data[0] as TextLayer).content.text).toBe('from-data');

    // only metadata has it
    const meta = resolveTokens(
      [textLayer('a', '{attr:role}')],
      block({ metadata: { role: 'from-metadata' } }),
    );
    expect((meta[0] as TextLayer).content.text).toBe('from-metadata');
  });

  it('stringifies non-string templateData values', () => {
    const layers = resolveTokens(
      [textLayer('a', 'n={attr:count}')],
      block({ templateData: { count: 42 } }),
    );
    expect((layers[0] as TextLayer).content.text).toBe('n=42');
  });

  it('collapses a missing attr to empty string', () => {
    const layers = resolveTokens([textLayer('a', '[{attr:missing}]')], block());
    expect((layers[0] as TextLayer).content.text).toBe('[]');
  });
});

describe('resolveTokens — pipe defaults', () => {
  it('uses the default when {title} is empty, the value when present', () => {
    const empty = resolveTokens([textLayer('a', '{title|Untitled}')], block({ title: undefined }));
    expect((empty[0] as TextLayer).content.text).toBe('Untitled');

    const present = resolveTokens([textLayer('a', '{title|Untitled}')], block({ title: 'Real' }));
    expect((present[0] as TextLayer).content.text).toBe('Real');
  });

  it('uses the default on a missing {attr:key|…}', () => {
    const layers = resolveTokens(
      [textLayer('a', '{attr:subtitle|Untitled}')],
      block({ templateOverrides: {} }),
    );
    expect((layers[0] as TextLayer).content.text).toBe('Untitled');
  });

  it('uses the image-src default (and keeps the layer) when the image index is out of range', () => {
    const layers = resolveTokens([imageLayer('a', '{image:1|fallback.jpg}')], block());
    expect(layers).toHaveLength(1);
    expect((layers[0] as ImageLayer).content.src).toBe('fallback.jpg');
  });

  it('still drops the image layer when {image:N} misses and no default is given', () => {
    const layers = resolveTokens([imageLayer('a', '{image:1}')], block());
    expect(layers).toHaveLength(0);
  });

  it('an empty default renders as empty (present token collapses to blank)', () => {
    const layers = resolveTokens([textLayer('a', '[{attr:x|}]')], block());
    expect((layers[0] as TextLayer).content.text).toBe('[]');
  });
});

describe('resolveTokens — escape vs pipe defaults', () => {
  it('leaves {{title|Untitled}} literal (escape shields the pipe default too)', () => {
    const layers = resolveTokens(
      [textLayer('a', 'Token: {{title|Untitled}}')],
      block({ title: 'Real' }),
    );
    expect((layers[0] as TextLayer).content.text).toBe('Token: {title|Untitled}');
  });
});

function repeatText(
  id: string,
  text: string,
  repeat: CustomTemplateLayer['repeat'],
): CustomTemplateLayer {
  return {
    id,
    type: 'text',
    position: { x: '0%', y: '10%', width: '30%', height: '20%' },
    content: { text, style: { fontSize: 24, color: '#000' } },
    repeat,
  };
}

const imagesBlock = block({
  contents: [
    {
      type: 'paragraph',
      children: [
        { type: 'image', url: '/one.png', alt: 'One' },
        { type: 'image', url: '/two.png', alt: 'Two' },
        { type: 'image', url: '/three.png', alt: 'Three' },
      ],
    },
  ],
});

describe('resolveTokens — repeat', () => {
  it('clones a layer once per image and resolves per-item tokens', () => {
    const layers = resolveTokens(
      [repeatText('cap', '{index}. {item} ({item:src})', { source: 'images' })],
      imagesBlock,
    );
    expect(layers).toHaveLength(3);
    expect((layers[0] as TextLayer).content.text).toBe('1. One (/one.png)');
    expect((layers[1] as TextLayer).content.text).toBe('2. Two (/two.png)');
    expect((layers[2] as TextLayer).content.text).toBe('3. Three (/three.png)');
  });

  it('gives each clone a unique id and strips the repeat prop', () => {
    const layers = resolveTokens([repeatText('cap', '{item}', { source: 'images' })], imagesBlock);
    expect(layers.map((l) => l.id)).toEqual(['cap-0', 'cap-1', 'cap-2']);
    expect(layers.every((l) => !('repeat' in l))).toBe(true);
  });

  it('iterates children titles', () => {
    const layers = resolveTokens(
      [repeatText('c', '{index}:{item}', { source: 'children' })],
      block({ children: [block({ id: 'a', title: 'Alpha' }), block({ id: 'b', title: 'Beta' })] }),
    );
    expect(layers.map((l) => (l as TextLayer).content.text)).toEqual(['1:Alpha', '2:Beta']);
  });

  it('iterates list items', () => {
    const layers = resolveTokens(
      [repeatText('li', '- {item}', { source: 'listItems' })],
      block({
        contents: [
          {
            type: 'list',
            ordered: false,
            children: [
              {
                type: 'listItem',
                children: [{ type: 'paragraph', children: [{ type: 'text', value: 'First' }] }],
              },
              {
                type: 'listItem',
                children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Second' }] }],
              },
            ],
          },
        ],
      }),
    );
    expect(layers.map((l) => (l as TextLayer).content.text)).toEqual(['- First', '- Second']);
  });

  it('caps the number of clones at max', () => {
    const layers = resolveTokens(
      [repeatText('cap', '{item}', { source: 'images', max: 2 })],
      imagesBlock,
    );
    expect(layers).toHaveLength(2);
    expect(layers.map((l) => (l as TextLayer).content.text)).toEqual(['One', 'Two']);
  });

  it('offsets position.y in column direction by height + gap', () => {
    const layers = resolveTokens(
      [repeatText('cap', '{item}', { source: 'images', direction: 'column', gap: 4 })],
      imagesBlock,
    );
    // base y = 10%, height = 20%, gap = 4 → cursor advances by 24 each item
    expect(layers.map((l) => l.position.y)).toEqual(['10%', '34%', '58%']);
    // x is untouched in column direction
    expect(layers.every((l) => l.position.x === '0%')).toBe(true);
  });

  it('offsets position.x in row direction by width + gap', () => {
    const layers = resolveTokens(
      [repeatText('cap', '{item}', { source: 'images', direction: 'row', gap: 10 })],
      imagesBlock,
    );
    // base x = 0%, width = 30%, gap = 10 → cursor advances by 40 each item
    expect(layers.map((l) => l.position.x)).toEqual(['0%', '40%', '80%']);
    expect(layers.every((l) => l.position.y === '10%')).toBe(true);
  });

  it('renders nothing when the source collection is empty', () => {
    const layers = resolveTokens([repeatText('cap', '{item}', { source: 'images' })], block());
    expect(layers).toHaveLength(0);
  });

  it('resolves {item:src} in an image layer inside a repeat', () => {
    const imgRepeat: CustomTemplateLayer = {
      id: 'img',
      type: 'image',
      position: { x: '0%', y: '0%', width: '25%', height: '25%' },
      content: { src: '{item:src}', alt: '{item:label}' },
      repeat: { source: 'images', direction: 'row', gap: 0 },
    };
    const layers = resolveTokens([imgRepeat], imagesBlock);
    expect(layers).toHaveLength(3);
    expect((layers[0] as ImageLayer).content.src).toBe('/one.png');
    expect((layers[0] as ImageLayer).content.alt).toBe('One');
    expect((layers[2] as ImageLayer).content.src).toBe('/three.png');
  });
});

describe('resolveTokens — {item}/{index} outside a repeat', () => {
  it('leaves per-item tokens literal when there is no repeat context', () => {
    const layers = resolveTokens([textLayer('a', '{item} {index}')], block());
    expect((layers[0] as TextLayer).content.text).toBe('{item} {index}');
  });
});

describe('collectListItems', () => {
  it('returns top-level list-item text and skips nested double-counting', () => {
    const b = block({
      contents: [
        {
          type: 'list',
          ordered: false,
          children: [
            {
              type: 'listItem',
              children: [
                { type: 'paragraph', children: [{ type: 'text', value: 'Parent' }] },
                {
                  type: 'list',
                  ordered: false,
                  children: [
                    {
                      type: 'listItem',
                      children: [
                        { type: 'paragraph', children: [{ type: 'text', value: 'Nested' }] },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Sibling' }] }],
            },
          ],
        },
      ],
    });
    // Only two top-level items; the nested item is folded into "Parent Nested".
    expect(collectListItems(b)).toEqual(['Parent Nested', 'Sibling']);
  });

  it('returns [] when the block has no list content', () => {
    expect(collectListItems(block())).toEqual([]);
  });
});
