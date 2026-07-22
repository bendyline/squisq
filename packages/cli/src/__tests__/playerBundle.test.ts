import { expect } from 'chai';
import type { Block, Doc } from '@bendyline/squisq/schemas';
import { selectStandalonePlayerVariant } from '../util/playerBundle.js';

function docWith(block: Block): Pick<Doc, 'blocks'> {
  return { blocks: [block] };
}

function blockWith(contents: Block['contents'] = []): Block {
  return {
    id: 'block-1',
    startTime: 0,
    duration: 5,
    audioSegment: 0,
    contents,
  };
}

describe('standalone player selection', () => {
  it('keeps ordinary video documents on the light player', () => {
    const doc = docWith(
      blockWith([
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'Plain content' }],
        },
      ]),
    );

    expect(selectStandalonePlayerVariant(doc)).to.equal('light');
  });

  it('uses the full player for a Mermaid Markdown fence', () => {
    const doc = docWith(
      blockWith([{ type: 'code', lang: ' Mermaid ', value: 'flowchart LR\n  A --> B' }]),
    );

    expect(selectStandalonePlayerVariant(doc)).to.equal('full');
  });

  it('finds a Mermaid fence nested inside Markdown containers', () => {
    const doc = docWith(
      blockWith([
        {
          type: 'blockquote',
          children: [{ type: 'code', lang: 'mermaid', value: 'sequenceDiagram' }],
        },
      ]),
    );

    expect(selectStandalonePlayerVariant(doc)).to.equal('full');
  });

  it('uses the full player for an already-materialized Mermaid layer', () => {
    const block = blockWith();
    block.layers = [
      {
        id: 'mermaid-1',
        type: 'mermaid',
        position: { x: 0, y: 0, width: 640, height: 360 },
        content: { source: 'flowchart LR\n  A --> B' },
      },
    ];

    expect(selectStandalonePlayerVariant(docWith(block))).to.equal('full');
  });
});
