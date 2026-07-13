import { describe, expect, it } from 'vitest';
import { parseMarkdown, stringifyMarkdown } from '../markdown/index';
import { markdownToDoc } from '../doc/markdownToDoc';
import { docToMarkdown } from '../doc/docToMarkdown';
import { materializeLayers } from './materializeTestUtils';
import { profileBlockContents, recommendTemplatesForBlock } from '../recommend/templates';
import type { Block, Layer } from '../schemas/Doc';
import type { DiagramTemplateEdge, DiagramTemplateNode } from '../schemas/BlockTemplates';
import { NESTED_CONTAINER, TWO_BOX_VERTICAL } from './fixtures/asciiDiagrams';

const fenced = (art: string, lang = ''): string => '```' + lang + '\n' + art + '\n```';

const AUTO_DOC = ['# Systems', '', '## Architecture', '', fenced(TWO_BOX_VERTICAL), ''].join('\n');

function convert(md: string, options?: Parameters<typeof markdownToDoc>[1]) {
  return markdownToDoc(parseMarkdown(md), { generateCoverBlock: false, ...options });
}

function findBlock(doc: { blocks: Block[] }, title: string): Block | undefined {
  const walk = (blocks: Block[]): Block | undefined => {
    for (const b of blocks) {
      if (b.title === title) return b;
      const inner = b.children ? walk(b.children) : undefined;
      if (inner) return inner;
    }
    return undefined;
  };
  return walk(doc.blocks);
}

describe('auto-template conversion of ASCII diagram fences', () => {
  it('converts a heading with a lone eligible fence into an ephemeral diagram block', () => {
    const doc = convert(AUTO_DOC);
    const block = findBlock(doc, 'Architecture');
    expect(block?.template).toBe('diagram');
    expect(block?.autoTemplate).toBe(true);
    const nodes = block?.templateData?.nodes as DiagramTemplateNode[];
    const edges = block?.templateData?.edges as DiagramTemplateEdge[];
    expect(nodes?.map((n) => n.id)).toEqual(['alpha', 'beta']);
    expect(nodes?.[0].w).toBeGreaterThan(0);
    expect(edges).toEqual([
      {
        source: 'alpha',
        target: 'beta',
        sourceAnchor: { side: 'bottom', offset: 0.5 },
        targetAnchor: { side: 'top', offset: 0.5 },
        routing: 'orthogonal',
      },
    ]);
    expect(block?.templateData?.title).toBe('Architecture');
  });

  it('round-trips losslessly: fence byte-identical, no annotation injected', () => {
    const doc = convert(AUTO_DOC);
    const output = stringifyMarkdown(docToMarkdown(doc));
    expect(output).toContain(TWO_BOX_VERTICAL);
    expect(output).not.toContain('{[diagram');
  });

  it('respects the autoTemplates option kill switch', () => {
    const doc = convert(AUTO_DOC, { autoTemplates: false });
    const block = findBlock(doc, 'Architecture');
    expect(block?.template).not.toBe('diagram');
  });

  it('respects the squisq-auto-templates frontmatter kill switch', () => {
    const md = `---\nsquisq-auto-templates: false\n---\n\n${AUTO_DOC}`;
    const doc = convert(md);
    const block = findBlock(doc, 'Architecture');
    expect(block?.template).not.toBe('diagram');
  });

  it('does not convert when the fence has a real language', () => {
    const md = ['## Architecture', '', fenced(TWO_BOX_VERTICAL, 'js'), ''].join('\n');
    const block = findBlock(convert(md), 'Architecture');
    expect(block?.template).not.toBe('diagram');
  });

  it('does not convert when a table competes with the fence', () => {
    const md = [
      '## Architecture',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      fenced(TWO_BOX_VERTICAL),
      '',
    ].join('\n');
    const block = findBlock(convert(md), 'Architecture');
    expect(block?.template).not.toBe('diagram');
  });

  it('does not convert when two fences are present', () => {
    const md = ['## Architecture', '', fenced(TWO_BOX_VERTICAL), '', fenced('plain code'), ''].join(
      '\n',
    );
    const block = findBlock(convert(md), 'Architecture');
    expect(block?.template).not.toBe('diagram');
  });

  it('does not convert when heavy prose surrounds the fence', () => {
    const prose = 'Lots of surrounding explanation text. '.repeat(15);
    const md = ['## Architecture', '', prose, '', fenced(TWO_BOX_VERTICAL), ''].join('\n');
    const block = findBlock(convert(md), 'Architecture');
    expect(block?.template).not.toBe('diagram');
  });
});

describe('explicit `diagram`-tagged fence (survives edit → round-trip)', () => {
  // The `diagram` fence LANGUAGE is the durable "block tag" — it round-trips
  // through markdown ↔ Tiptap as `class="language-diagram"`, and explicit-lang
  // detection accepts a degenerate single-box diagram that would otherwise be
  // rejected (the ≥2-box floor is for UNTAGGED auto-detection only).
  const ONE_BOX = ['┌────────┐', '│ Solo   │', '└────────┘'].join('\n');
  const TAGGED_DOC = ['# Systems', '', '## Architecture', '', fenced(ONE_BOX, 'diagram'), ''].join(
    '\n',
  );

  it('a bare single-box fence does NOT become a diagram', () => {
    const md = ['## Architecture', '', fenced(ONE_BOX), ''].join('\n');
    expect(findBlock(convert(md), 'Architecture')?.template).not.toBe('diagram');
  });

  it('a `diagram`-tagged single-box fence DOES become a diagram', () => {
    const block = findBlock(convert(TAGGED_DOC), 'Architecture');
    expect(block?.template).toBe('diagram');
    expect(block?.autoTemplate).toBe(true);
    const nodes = block?.templateData?.nodes as DiagramTemplateNode[];
    expect(nodes?.map((n) => n.id)).toEqual(['solo']);
  });

  it('round-trips losslessly: fence + `diagram` lang preserved, no annotation injected', () => {
    const output = stringifyMarkdown(docToMarkdown(convert(TAGGED_DOC)));
    expect(output).toContain('```diagram');
    expect(output).toContain(ONE_BOX);
    expect(output).not.toContain('{[diagram');
    // Re-importing keeps it a diagram — the identity is sticky.
    expect(findBlock(convert(output), 'Architecture')?.template).toBe('diagram');
  });

  it('profiles a `diagram`-tagged single-box fence as hasAsciiDiagram', () => {
    const md = parseMarkdown(fenced(ONE_BOX, 'diagram'));
    const profile = profileBlockContents(md.children as Parameters<typeof profileBlockContents>[0]);
    expect(profile.hasAsciiDiagram).toBe(true);
  });
});

describe('explicit {[diagram]} annotation with an ASCII fence', () => {
  const EXPLICIT_DOC = ['## Flow {[diagram]}', '', fenced(TWO_BOX_VERTICAL), ''].join('\n');

  it('derives nodes/edges even with autoTemplates off', () => {
    const doc = convert(EXPLICIT_DOC, { autoTemplates: false });
    const block = findBlock(doc, 'Flow');
    expect(block?.template).toBe('diagram');
    const nodes = block?.templateData?.nodes as DiagramTemplateNode[];
    expect(nodes?.map((n) => n.id)).toEqual(['alpha', 'beta']);
  });

  it('keeps the explicit annotation and fence through a round-trip', () => {
    const doc = convert(EXPLICIT_DOC);
    const output = stringifyMarkdown(docToMarkdown(doc));
    expect(output).toContain('{[diagram]}');
    expect(output).toContain(TWO_BOX_VERTICAL);
  });

  it('lets an author json data fence win over the ASCII fence', () => {
    const md = [
      '## Flow {[diagram]}',
      '',
      '```json data',
      JSON.stringify({
        nodes: [
          { id: 'only', label: 'Only', x: 0, y: 0 },
          { id: 'two', label: 'Two', x: 200, y: 0 },
        ],
        edges: [],
      }),
      '```',
      '',
    ].join('\n');
    const doc = convert(md);
    const block = findBlock(doc, 'Flow');
    const nodes = block?.templateData?.nodes as DiagramTemplateNode[];
    expect(nodes?.map((n) => n.id)).toEqual(['only', 'two']);
  });

  it('records a diagnostic when the fence does not parse as a diagram', () => {
    const md = ['## Flow {[diagram]}', '', fenced('just some text\nnothing else\nhere'), ''].join(
      '\n',
    );
    const doc = convert(md);
    expect(doc.diagnostics?.some((d) => d.code === 'ascii-diagram-parse')).toBe(true);
  });

  it('children-driven diagrams win over a stray fence in the body', () => {
    const md = [
      '## Flow {[diagram]}',
      '',
      fenced(TWO_BOX_VERTICAL),
      '',
      '### NodeA {#node-a x=100 y=100}',
      '',
      '### NodeB {#node-b x=400 y=100 connectsTo=node-a}',
      '',
    ].join('\n');
    const doc = convert(md);
    const block = findBlock(doc, 'Flow');
    expect(block?.children?.length).toBe(2);
    expect(block?.templateData?.nodes).toBeUndefined();
  });
});

describe('rendering derived diagrams through materializeBlockLayers', () => {
  it('renders container cards behind leaf cards with per-node sizes', () => {
    const md = ['## Pipeline', '', fenced(NESTED_CONTAINER), ''].join('\n');
    const doc = convert(md);
    const block = findBlock(doc, 'Pipeline');
    expect(block?.template).toBe('diagram');
    const layers = materializeLayers(block as Block, {});
    const ids = layers.map((l: Layer) => l.id);
    // Container card present and drawn before (behind) leaf cards.
    const containerIdx = ids.indexOf('node-card-data-pipeline');
    const leafIdx = ids.indexOf('node-card-ingest');
    expect(containerIdx).toBeGreaterThanOrEqual(0);
    expect(leafIdx).toBeGreaterThan(containerIdx);
    // Edges exist.
    expect(ids.some((id) => id.startsWith('edge-'))).toBe(true);
  });

  it('renders undirected edges without an end marker', () => {
    const art = [
      '┌────────┐     ┌────────┐',
      '│ Left   │─────│ Right  │',
      '└────────┘     └────────┘',
    ].join('\n');
    const md = ['## Pair', '', fenced(art), ''].join('\n');
    const block = findBlock(convert(md), 'Pair');
    const layers = materializeLayers(block as Block, {});
    const edge = layers.find((l: Layer) => l.id.startsWith('edge-'));
    expect(edge).toBeDefined();
    expect((edge as { content: { endMarker?: string } }).content.endMarker).toBeUndefined();
  });
});

describe('duration/caption hygiene', () => {
  it('excludes a consumed fence from reading-time and captions', () => {
    // The size of the consumed art must not affect the block's duration:
    // a tiny diagram and a huge one read identically (the fence text is
    // data, not narration).
    const small = findBlock(convert(AUTO_DOC), 'Architecture');
    const bigDoc = convert(
      ['# Systems', '', '## Architecture', '', fenced(NESTED_CONTAINER), ''].join('\n'),
    );
    const big = findBlock(bigDoc, 'Architecture');
    expect(small?.template).toBe('diagram');
    expect(big?.template).toBe('diagram');
    expect(big?.duration).toBe(small?.duration);
    const captionText = (bigDoc.captions?.phrases ?? []).map((p) => p.text).join(' ');
    expect(captionText).not.toContain('┌');
    expect(captionText).not.toContain('│');
  });
});

describe('template picker recommendation', () => {
  it('surfaces diagram for a fence-bearing profile', () => {
    const md = parseMarkdown(fenced(TWO_BOX_VERTICAL));
    const profile = profileBlockContents(md.children as Parameters<typeof profileBlockContents>[0]);
    expect(profile.hasAsciiDiagram).toBe(true);
    const { recommended } = recommendTemplatesForBlock(profile, ['diagram', 'title', 'quote']);
    expect(recommended).toContain('diagram');
  });
});
