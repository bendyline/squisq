/**
 * Registry merge — end-to-end: a doc that uses a custom template name
 * resolves through `expandDocBlocks(opts.customTemplates)` and produces
 * layers with tokens substituted from the source block.
 */

import { describe, it, expect } from 'vitest';
import { buildRegistry, expandDocBlocks } from '../index';
import type { CustomTemplateDefinition } from '../../../schemas/CustomTemplates.js';
import type { Block, TextLayer } from '../../../schemas/Doc.js';

const heroDef: CustomTemplateDefinition = {
  name: 'hero',
  label: 'Hero',
  viewport: { width: 1920, height: 1080 },
  layers: [
    {
      id: 'title',
      type: 'text',
      position: { x: '5%', y: '10%', width: '90%' },
      content: { text: '{title}', style: { fontSize: 72, color: '#000' } },
    },
    {
      id: 'body',
      type: 'text',
      position: { x: '5%', y: '40%', width: '90%' },
      content: { text: '{content}', style: { fontSize: 32, color: '#333' } },
    },
  ],
};

describe('buildRegistry', () => {
  it('merges custom templates onto the built-in registry', () => {
    const reg = buildRegistry([heroDef]);
    expect(reg.hero).toBeDefined();
    expect(reg.title).toBeDefined(); // built-in survives
  });

  it('does not let custom templates shadow built-in names', () => {
    const collide: CustomTemplateDefinition = {
      ...heroDef,
      name: 'title', // collides with built-in
    };
    const reg = buildRegistry([collide]);
    // Built-in `title` is preserved — the collide entry is silently
    // dropped (callers shouldn't have created it). We verify by
    // checking the function reference is the original built-in's.
    const builtIn = buildRegistry();
    expect(reg.title).toBe(builtIn.title);
  });
});

describe('expandDocBlocks with customTemplates', () => {
  it('expands a doc-defined template name into resolved layers', () => {
    const block: Block = {
      id: 'b1',
      startTime: 0,
      duration: 1,
      audioSegment: 0,
      title: 'Welcome',
      template: 'hero',
      contents: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'A small editor for big ideas.' }],
        },
      ],
    };

    const expanded = expandDocBlocks([block], { customTemplates: [heroDef] });
    expect(expanded).toHaveLength(1);
    const layers = expanded[0].layers ?? [];
    expect(layers).toHaveLength(2);
    expect((layers[0] as TextLayer).content.text).toBe('Welcome');
    expect((layers[1] as TextLayer).content.text).toBe('A small editor for big ideas.');
  });

  it('preserves %-based positions so the SSR renderer can resolve them per viewport', () => {
    const block: Block = {
      id: 'b1',
      startTime: 0,
      duration: 1,
      audioSegment: 0,
      title: 'X',
      template: 'hero',
    };
    const expanded = expandDocBlocks([block], { customTemplates: [heroDef] });
    expect(expanded[0].layers![0].position.x).toBe('5%');
    expect(expanded[0].layers![0].position.width).toBe('90%');
  });

  it('falls back to a no-layer block (with a warning) when the template is unknown', () => {
    // Suppress the expected console.warn from `expandTemplateBlock`.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const block: Block = {
      id: 'b1',
      startTime: 0,
      duration: 1,
      audioSegment: 0,
      title: 'Y',
      template: 'nonexistent',
    };
    const expanded = expandDocBlocks([block], { customTemplates: [heroDef] });
    expect(expanded[0].layers).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

import { vi } from 'vitest';
