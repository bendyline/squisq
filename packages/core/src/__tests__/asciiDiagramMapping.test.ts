import { describe, expect, it } from 'vitest';
import { asciiDiagramToTemplateData, parseAsciiDiagram } from '../doc/asciiDiagram/index';
import { diagramBlock } from '../doc/templates/diagramBlock';
import { createTemplateContext } from '../schemas/BlockTemplates';
import { DEFAULT_THEME } from '../schemas/themeLibrary';
import { VIEWPORT_PRESETS } from '../schemas/Viewport';
import type { PathLayer } from '../schemas/Doc';

const LOAD_BALANCER_FAN_OUT = `           ┌───────────────┐
           │ Load Balancer │
           └──┬──┬──┬──┬───┘
       ┌──────┘  │  │  └──────┐
       ▼         ▼  ▼         ▼
    ┌──────┐┌──────┐┌──────┐┌──────┐
    │ Web1 ││ Web2 ││ Web3 ││ Web4 │
    └──────┘└──────┘└──────┘└──────┘`;

describe('ASCII diagram canvas mapping', () => {
  it('maps aligned fan-out arrows to one centered orthogonal trunk', () => {
    const diagram = parseAsciiDiagram(LOAD_BALANCER_FAN_OUT);
    const { nodes, edges } = asciiDiagramToTemplateData(diagram);

    expect(edges.map((edge) => edge.target)).toEqual(['web1', 'web2', 'web3', 'web4']);
    expect(edges.map((edge) => edge.routing)).toEqual([
      'orthogonal',
      'orthogonal',
      'orthogonal',
      'orthogonal',
    ]);
    expect(edges.map((edge) => edge.sourceAnchor)).toEqual(
      Array(4).fill({ side: 'bottom', offset: 0.5 }),
    );
    expect(edges.map((edge) => edge.targetAnchor)).toEqual([
      { side: 'top', offset: 0.5 },
      { side: 'top', offset: 0.5 },
      { side: 'top', offset: 0.5 },
      { side: 'top', offset: 0.5 },
    ]);

    const context = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
    const layers = diagramBlock(
      {
        template: 'diagram',
        id: 'fan-out',
        duration: 0,
        audioSegment: 0,
        nodes,
        edges,
      },
      context,
    );
    const paths = layers.filter((layer): layer is PathLayer => layer.type === 'path');
    const initialLegs = paths.map((path) => path.content.d.split(' L ').slice(0, 2).join(' L '));
    expect(new Set(initialLegs).size).toBe(1);
  });
});
