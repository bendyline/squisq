import mermaid from 'mermaid';
import { beforeAll, describe, expect, it } from 'vitest';
import type { MermaidFlowchartModel } from '../mermaidModel';
import {
  addMermaidNode,
  changeMermaidNodeShape,
  connectMermaidNodes,
  deleteMermaidNode,
  disconnectMermaidEdge,
  duplicateMermaidNode,
  renameMermaidNode,
  setMermaidEdgeLabel,
  setMermaidFlowchartDirection,
  upsertMermaidNode,
} from '../mermaidSourceOps';
import { MERMAID_FLOWCHART_SHAPES } from '../mermaidShapes';

const source = 'flowchart LR\n  start["Start"] --> next["Next"]';
const model: MermaidFlowchartModel = {
  kind: 'flowchart',
  direction: 'LR',
  nodes: [
    { id: 'start', domId: 'flowchart-start-0', label: 'Start', shape: 'rect', classes: [] },
    { id: 'next', domId: 'flowchart-next-1', label: 'Next', shape: 'rect', classes: [] },
  ],
  edges: [
    { id: 'L_start_next_0', source: 'start', target: 'next', label: '', type: 'arrow_point' },
  ],
};

beforeAll(() => {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
  });
});

describe('Mermaid shape coverage', () => {
  it('covers every ordinary shape in Mermaid 11.16’s documented expanded catalog', () => {
    expect(MERMAID_FLOWCHART_SHAPES).toHaveLength(48);
    expect(new Set(MERMAID_FLOWCHART_SHAPES.map((shape) => shape.id)).size).toBe(48);
  });

  it('round-trips all 48 shapes through the pinned Mermaid parser', async () => {
    const shapeSource = [
      'flowchart TB',
      ...MERMAID_FLOWCHART_SHAPES.map(
        (shape, index) =>
          `  node${index}@{ shape: ${shape.id}, label: ${JSON.stringify(shape.label)} }`,
      ),
    ].join('\n');
    await expect(mermaid.parse(shapeSource)).resolves.toMatchObject({
      diagramType: expect.stringMatching(/^flowchart/),
    });
  });
});

describe('Mermaid source operations', () => {
  it('updates one managed declaration for repeated rename and shape edits', async () => {
    const renamed = renameMermaidNode(source, model.nodes[0], 'Begin');
    expect(renamed.ok).toBe(true);
    const shaped = changeMermaidNodeShape(
      renamed.source,
      { ...model.nodes[0], label: 'Begin' },
      'cloud',
    );
    expect(shaped.source.match(/%% squisq:node start/g)).toHaveLength(1);
    expect(shaped.source).toContain('start@{ shape: cloud, label: "Begin" }');
    await expect(mermaid.parse(shaped.source)).resolves.toBeTruthy();
  });

  it('adds, duplicates, and connects nodes as ordinary Mermaid statements', async () => {
    const added = addMermaidNode(source, model, 'doc');
    expect(added.nodeId).toBe('node');
    const duplicated = duplicateMermaidNode(added.source, model, model.nodes[1]);
    expect(duplicated.nodeId).toBe('next_copy');
    const expandedModel: MermaidFlowchartModel = {
      ...model,
      nodes: [
        ...model.nodes,
        { id: 'node', domId: 'node', label: 'New node', shape: 'doc', classes: [] },
      ],
    };
    const connected = connectMermaidNodes(duplicated.source, expandedModel, 'next', 'node');
    expect(connected.source).toContain('next --> node');
    await expect(mermaid.parse(connected.source)).resolves.toBeTruthy();
  });

  it('deletes a node from a simple edge while preserving its peer declaration', async () => {
    const deleted = deleteMermaidNode(source, model, 'start');
    expect(deleted.ok).toBe(true);
    expect(deleted.source).not.toContain('start');
    expect(deleted.source).toContain('next@{ shape: rect, label: "Next" }');
    await expect(mermaid.parse(deleted.source)).resolves.toBeTruthy();
  });

  it('disconnects a simple edge while preserving both endpoint declarations', async () => {
    const disconnected = disconnectMermaidEdge(source, model, model.edges[0]);
    expect(disconnected.ok).toBe(true);
    expect(disconnected.source).not.toContain('-->');
    expect(disconnected.source).toContain('start@{ shape: rect, label: "Start" }');
    expect(disconnected.source).toContain('next@{ shape: rect, label: "Next" }');
    await expect(mermaid.parse(disconnected.source)).resolves.toBeTruthy();
  });

  it('adds, updates, and removes an ordinary Mermaid connection label', async () => {
    const labeled = setMermaidEdgeLabel(source, model, model.edges[0], 'continues');
    expect(labeled.ok).toBe(true);
    expect(labeled.source).toContain('-->|"continues"| next["Next"]');
    await expect(mermaid.parse(labeled.source)).resolves.toBeTruthy();

    const labeledEdge = { ...model.edges[0], label: 'continues' };
    const updated = setMermaidEdgeLabel(labeled.source, model, labeledEdge, 'when ready');
    expect(updated.ok).toBe(true);
    expect(updated.source).toContain('-->|"when ready"| next["Next"]');
    await expect(mermaid.parse(updated.source)).resolves.toBeTruthy();

    const cleared = setMermaidEdgeLabel(
      updated.source,
      model,
      { ...model.edges[0], label: 'when ready' },
      '',
    );
    expect(cleared.ok).toBe(true);
    expect(cleared.source).toBe(source);
    await expect(mermaid.parse(cleared.source)).resolves.toBeTruthy();
  });

  it('labels Squisq-managed connections without adding a second edge statement', async () => {
    const expandedModel: MermaidFlowchartModel = {
      ...model,
      nodes: [
        ...model.nodes,
        { id: 'third', domId: 'third', label: 'Third', shape: 'rect', classes: [] },
      ],
    };
    const connected = connectMermaidNodes(source, expandedModel, 'next', 'third');
    const managedEdge = {
      id: 'managed',
      source: 'next',
      target: 'third',
      label: '',
    };
    const labeled = setMermaidEdgeLabel(connected.source, expandedModel, managedEdge, 'handoff');
    expect(labeled.ok).toBe(true);
    expect(labeled.source.match(/next -->/g)).toHaveLength(1);
    expect(labeled.source).toContain('next -->|"handoff"| third');
    await expect(mermaid.parse(labeled.source)).resolves.toBeTruthy();
  });

  it('refuses to label an edge inside a compact statement', () => {
    const denseSource = 'flowchart LR\n  start & next --> third';
    const denseModel: MermaidFlowchartModel = {
      kind: 'flowchart',
      direction: 'LR',
      nodes: ['start', 'next', 'third'].map((id) => ({
        id,
        domId: id,
        label: id,
        shape: 'rect' as const,
        classes: [],
      })),
      edges: [
        { id: '1', source: 'start', target: 'third', label: '' },
        { id: '2', source: 'next', target: 'third', label: '' },
      ],
    };
    const result = setMermaidEdgeLabel(denseSource, denseModel, denseModel.edges[0], 'unsafe');
    expect(result.ok).toBe(false);
    expect(result.source).toBe(denseSource);
  });

  it('refuses a destructive edit that would erase unrelated compact edges', () => {
    const denseSource = 'flowchart LR\n  start & next --> third & fourth';
    const denseModel: MermaidFlowchartModel = {
      kind: 'flowchart',
      direction: 'LR',
      nodes: ['start', 'next', 'third', 'fourth'].map((id) => ({
        id,
        domId: id,
        label: id,
        shape: 'rect' as const,
        classes: [],
      })),
      edges: [
        { id: '1', source: 'start', target: 'third', label: '' },
        { id: '2', source: 'start', target: 'fourth', label: '' },
        { id: '3', source: 'next', target: 'third', label: '' },
        { id: '4', source: 'next', target: 'fourth', label: '' },
      ],
    };
    const result = deleteMermaidNode(denseSource, denseModel, 'next');
    expect(result.ok).toBe(false);
    expect(result.source).toBe(denseSource);
  });

  it('changes the diagram direction without touching the body', () => {
    const result = setMermaidFlowchartDirection(source, 'TB');
    expect(result.source).toBe('flowchart TB\n  start["Start"] --> next["Next"]');
  });

  it('rejects ids that cannot be safely emitted in general node syntax', () => {
    expect(
      upsertMermaidNode(source, {
        id: 'not safe',
        label: 'Nope',
        shape: 'rect',
        classes: [],
      }).ok,
    ).toBe(false);
  });
});
