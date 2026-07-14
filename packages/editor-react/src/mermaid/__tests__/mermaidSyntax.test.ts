import mermaid from 'mermaid';
import { beforeAll, describe, expect, it } from 'vitest';

const COMPLEX_FLOWCHART = [
  'flowchart LR',
  '  client["MCP client"] <--> transport["Local stdio transport"]',
  '  transport <--> sdk["MCP SDK server"]',
  '',
  '  subgraph docblocks["DocBlocks MCP process"]',
  '    sdk --> tools["19 strict tools"]',
  '    tools --> guard["Guarded expensive operations"]',
  '    guard --> documents["DocumentService: source resolution and normalization"]',
  '    guard --> intelligence["Inspect, validate, compare, preview"]',
  '    guard --> conversion["Fidelity and conversion orchestration"]',
  '    tools --> authority["McpFileAuthority: granted roots and containment"]',
  '    tools --> artifacts["Session ArtifactStore and reports"]',
  '    documents --> conversion',
  '    conversion --> artifacts',
  '    intelligence --> artifacts',
  '  end',
  '',
  '  documents --> squisq["Linked Squisq parser, Doc model, formats, themes, templates"]',
  '  conversion --> squisq',
  '  intelligence --> squisq',
  '  artifacts --> resources["Artifact and report resources"]',
  '  authority --> filesystem["Explicitly granted local roots"]',
].join('\n');

beforeAll(() => {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
  });
});

describe('pinned Mermaid syntax integration', () => {
  it('accepts the requested complex flowchart through Mermaid itself', async () => {
    await expect(mermaid.parse(COMPLEX_FLOWCHART)).resolves.toMatchObject({
      diagramType: expect.stringMatching(/^flowchart/),
    });
  });

  it.each([
    ['sequence', 'sequenceDiagram\n  Alice->>Bob: Hello'],
    ['state', 'stateDiagram-v2\n  [*] --> Ready'],
    ['class', 'classDiagram\n  Animal <|-- Duck'],
    ['er', 'erDiagram\n  CUSTOMER ||--o{ ORDER : places'],
    ['gantt', 'gantt\n  title Plan\n  section Work\n  Task :a1, 2026-01-01, 1d'],
    ['mindmap', 'mindmap\n  root((Squisq))\n    Core\n    Editor'],
  ])('accepts %s diagrams without a Squisq-specific parser', async (_name, source) => {
    await expect(mermaid.parse(source)).resolves.toBeTruthy();
  });
});
