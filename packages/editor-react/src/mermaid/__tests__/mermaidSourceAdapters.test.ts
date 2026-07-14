import { beforeAll, describe, expect, it } from 'vitest';
import mermaid from 'mermaid';
import { MERMAID_DIAGRAM_TYPES } from '../mermaidDiagramTypes';
import {
  addAdapterNode,
  connectAdapterNodes,
  deleteAdapterNode,
  disconnectAdapterEdge,
  duplicateAdapterNode,
  inspectMermaidSourceAdapter,
  renameAdapterNode,
  setAdapterEdgeLabel,
  setAdapterProperty,
} from '../mermaidSourceAdapters';

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, suppressErrorRendering: true, securityLevel: 'strict' });
});

const sourceTypes = MERMAID_DIAGRAM_TYPES.filter((type) => type.id !== 'flowchart');

function editableName(kind: string): string {
  if (kind === 'er') return 'RENAMED_ENTITY';
  if (kind === 'sankey') return 'Renamed flow node';
  return 'Renamed item';
}

function edgeLabel(kind: string): string {
  if (kind === 'sankey') return '42';
  if (kind === 'requirement') return 'verifies';
  return 'edited relationship';
}

function propertyValue(id: string, current: string | boolean): string | boolean {
  if (typeof current === 'boolean') return !current;
  if (id === 'direction') return current === 'LR' ? 'TB' : 'LR';
  if (id === 'dateFormat') return 'YYYY-MM-DD';
  if (id === 'title') return 'Edited diagram';
  return current || 'Edited value';
}

describe('Mermaid source adapters', () => {
  it.each(sourceTypes)('inspects $label starter as editable source entities', ({ starter }) => {
    const model = inspectMermaidSourceAdapter(starter);
    expect(model).not.toBeNull();
    expect(model?.nodes.length || model?.edges.length).toBeGreaterThan(0);
  });

  it.each(sourceTypes)(
    'keeps every advertised $label gesture valid Mermaid',
    async ({ starter }) => {
      const model = inspectMermaidSourceAdapter(starter);
      expect(model).not.toBeNull();
      if (!model) return;

      const candidates: { name: string; source: string }[] = [];
      const first = model.nodes[0];
      const last = model.nodes[model.nodes.length - 1];
      const firstEdge = model.edges[0];

      if (model.capabilities.addNode) {
        const result = addAdapterNode(starter, model);
        expect(result.ok, `${model.kind} add: ${result.reason}`).toBe(true);
        candidates.push({ name: 'add', source: result.source });
      }
      if (model.capabilities.renameNode && first) {
        const result = renameAdapterNode(starter, model, first, editableName(model.kind));
        expect(result.ok, `${model.kind} rename: ${result.reason}`).toBe(true);
        candidates.push({ name: 'rename', source: result.source });
      }
      if (model.capabilities.duplicateNode && last) {
        const result = duplicateAdapterNode(starter, model, last);
        expect(result.ok, `${model.kind} duplicate: ${result.reason}`).toBe(true);
        candidates.push({ name: 'duplicate', source: result.source });
      }
      if (model.capabilities.deleteNode && last) {
        const result = deleteAdapterNode(starter, model, last);
        expect(result.ok, `${model.kind} delete: ${result.reason}`).toBe(true);
        candidates.push({ name: 'delete', source: result.source });
      }
      if (model.capabilities.connect && model.nodes.length > 1) {
        const pair = model.nodes
          .flatMap((source) => model.nodes.map((target) => [source, target] as const))
          .find(
            ([source, target]) =>
              source.id !== target.id &&
              !model.edges.some((edge) => edge.source === source.id && edge.target === target.id),
          );
        if (pair) {
          const result = connectAdapterNodes(starter, model, pair[0].id, pair[1].id);
          expect(result.ok, `${model.kind} connect: ${result.reason}`).toBe(true);
          candidates.push({ name: 'connect', source: result.source });
        }
      }
      if (model.capabilities.disconnect && firstEdge) {
        const result = disconnectAdapterEdge(starter, model, firstEdge);
        expect(result.ok, `${model.kind} disconnect: ${result.reason}`).toBe(true);
        candidates.push({ name: 'disconnect', source: result.source });
      }
      if (model.capabilities.edgeLabel && firstEdge) {
        const result = setAdapterEdgeLabel(starter, model, firstEdge, edgeLabel(model.kind));
        expect(result.ok, `${model.kind} edge label: ${result.reason}`).toBe(true);
        candidates.push({ name: 'edge label', source: result.source });
      }
      for (const property of model.properties.slice(0, 2)) {
        const result = setAdapterProperty(
          starter,
          model,
          property.id,
          propertyValue(property.id, property.value),
        );
        if (result.ok) candidates.push({ name: `property ${property.id}`, source: result.source });
      }

      for (const candidate of candidates) {
        await expect(
          mermaid.parse(candidate.source),
          `${model.kind} ${candidate.name}\n${candidate.source}`,
        ).resolves.toBeTruthy();
      }
    },
  );

  it('models Gantt tasks and after clauses as editable nodes and dependencies', () => {
    const gantt = MERMAID_DIAGRAM_TYPES.find((type) => type.id === 'gantt')!;
    const model = inspectMermaidSourceAdapter(gantt.starter)!;
    expect(model.kind).toBe('gantt');
    expect(model.nodes.map((node) => [node.id, node.label])).toEqual([
      ['design', 'Design'],
      ['build', 'Implement'],
      ['gantt-task-6', 'Ship'],
    ]);
    expect(model.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['design', 'build'],
      ['build', 'gantt-task-6'],
    ]);
  });

  it('materializes a stable Gantt task id when an implicit-id task becomes a dependency', async () => {
    const gantt = MERMAID_DIAGRAM_TYPES.find((type) => type.id === 'gantt')!;
    const model = inspectMermaidSourceAdapter(gantt.starter)!;
    const result = connectAdapterNodes(gantt.starter, model, 'gantt-task-6', 'design');
    expect(result.ok).toBe(true);
    expect(result.source).toContain('Ship :milestone, task, after build, 0d');
    expect(result.source).toContain('Design :done, design, after task, 3d');
    await expect(mermaid.parse(result.source)).resolves.toBeTruthy();
  });

  it('models each event on a Timeline period as an editable node', () => {
    const timeline = MERMAID_DIAGRAM_TYPES.find((type) => type.id === 'timeline')!;
    const model = inspectMermaidSourceAdapter(timeline.starter)!;
    expect(model.kind).toBe('timeline');
    expect(model.nodes.map((node) => node.label)).toEqual(['Research', 'Build', 'Test', 'Launch']);
    expect(model.capabilities.connectionHint).toContain('chronological order');
  });
});
