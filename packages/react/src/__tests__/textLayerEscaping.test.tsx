/**
 * Code shown on a slide stays code. A fence's markup reaches the text layer
 * escaped; the layer's re-sanitize pass must not turn it back into elements.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { markdownToDoc, buildPreviewDoc, materializeBlockLayers } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { Block, DocBlock } from '@bendyline/squisq/schemas';
import { BlockRenderer } from '../BlockRenderer';

describe('code in slide text', () => {
  it('renders an html fence as text, never as live elements', () => {
    const doc = markdownToDoc(
      parseMarkdown(
        '## Markup\n\n```html\n<img src="x" onerror="window.__squisqInjected = true"><svg><circle r="10"/></svg>\n```',
      ),
      { generateCoverBlock: false },
    );
    const slide = buildPreviewDoc(doc).blocks[0] as DocBlock;
    const block = {
      ...slide,
      layers: materializeBlockLayers(slide, { persistentLayers: false }).layers,
    } as Block;
    const { container } = render(<BlockRenderer block={block} blockTime={0} basePath="/" />);
    const body = container.querySelector('.block-layer--text pre');
    expect(body).not.toBeNull();
    expect(body!.querySelector('img, svg, circle')).toBeNull();
    expect(body!.textContent).toContain('<img src="x" onerror=');
    expect((window as { __squisqInjected?: boolean }).__squisqInjected).toBeUndefined();
  });

  it('keeps a rich text layer’s escaped text as text', () => {
    const block: Block = {
      id: 'slide',
      startTime: 0,
      duration: 5,
      audioSegment: 0,
      layers: [
        {
          type: 'text',
          id: 'body',
          content: {
            text: 'x',
            html: '<p>Use &lt;b&gt; for bold &amp; &lt;i&gt; for italic</p>',
            style: { fontSize: 28, color: '#000000' },
          },
          position: { x: 0, y: 0, width: 800, height: 200 },
        },
      ],
    };
    const { container } = render(<BlockRenderer block={block} blockTime={0} basePath="/" />);
    const paragraph = container.querySelector('.block-layer--text p');
    expect(paragraph?.querySelector('b, i')).toBeNull();
    expect(paragraph?.textContent).toBe('Use <b> for bold & <i> for italic');
  });
});
