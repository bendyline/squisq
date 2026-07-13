import { describe, expect, it } from 'vitest';
import { asciiDiagramToTemplateData, parseAsciiDiagram } from '../doc/asciiDiagram/index';

const LOAD_BALANCER_FAN_OUT = `           ┌───────────────┐
           │ Load Balancer │
           └──┬──┬──┬──┬───┘
       ┌──────┘  │  │  └──────┐
       ▼         ▼  ▼         ▼
    ┌──────┐┌──────┐┌──────┐┌──────┐
    │ Web1 ││ Web2 ││ Web3 ││ Web4 │
    └──────┘└──────┘└──────┘└──────┘`;

describe('ASCII diagram canvas mapping', () => {
  it('maps fan-out arrows to distributed bottom ports and top-center targets', () => {
    const diagram = parseAsciiDiagram(LOAD_BALANCER_FAN_OUT);
    const { edges } = asciiDiagramToTemplateData(diagram);

    expect(edges.map((edge) => edge.target)).toEqual(['web1', 'web2', 'web3', 'web4']);
    expect(edges.map((edge) => edge.routing)).toEqual([
      'orthogonal',
      'orthogonal',
      'orthogonal',
      'orthogonal',
    ]);
    expect(edges.map((edge) => edge.sourceAnchor)).toEqual([
      { side: 'bottom', offset: 0.2 },
      { side: 'bottom', offset: 0.4 },
      { side: 'bottom', offset: 0.6 },
      { side: 'bottom', offset: 0.8 },
    ]);
    expect(edges.map((edge) => edge.targetAnchor)).toEqual([
      { side: 'top', offset: 0.5 },
      { side: 'top', offset: 0.5 },
      { side: 'top', offset: 0.5 },
      { side: 'top', offset: 0.5 },
    ]);
  });
});
