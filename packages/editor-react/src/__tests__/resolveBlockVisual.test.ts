import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import type { Block, Doc, TextLayer } from '@bendyline/squisq/schemas';
import { resolveBlockVisual } from '../resolveBlockVisual';

describe('resolveBlockVisual', () => {
  it('materializes document-scoped custom templates in editor previews', () => {
    const block: Block = {
      id: 'custom',
      startTime: 0,
      duration: 5,
      audioSegment: 0,
      template: 'hero',
      title: 'Editor custom template',
    };
    const doc: Doc = {
      articleId: 'custom-preview',
      duration: 5,
      blocks: [block],
      audio: { segments: [] },
      customTemplates: [
        {
          name: 'hero',
          label: 'Hero',
          viewport: { width: 1920, height: 1080 },
          layers: [
            {
              id: 'hero-title',
              type: 'text',
              position: { x: '5%', y: '10%', width: '90%' },
              content: { text: '{title}', style: { fontSize: 48, color: '#000000' } },
            },
          ],
        },
      ],
    };

    const visual = resolveBlockVisual(doc, block, DEFAULT_THEME, VIEWPORT_PRESETS.landscape);

    expect(visual).not.toBeNull();
    expect((visual?.layers?.[0] as TextLayer).content.text).toBe('Editor custom template');
  });
});
