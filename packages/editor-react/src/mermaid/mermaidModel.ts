import type { MermaidFlowchartShapeId } from './mermaidShapes';

export type MermaidFlowchartDirection = 'TB' | 'TD' | 'BT' | 'RL' | 'LR';

export type MermaidEditableDiagramKind =
  | 'flowchart'
  | 'sequence'
  | 'state'
  | 'class'
  | 'er'
  | 'mindmap'
  | 'c4'
  | 'architecture'
  | 'gantt'
  | 'timeline'
  | 'journey'
  | 'kanban'
  | 'git'
  | 'pie'
  | 'quadrant'
  | 'sankey'
  | 'xy'
  | 'requirement';

export interface MermaidEditCapabilities {
  readonly addNode: boolean;
  readonly renameNode: boolean;
  readonly duplicateNode: boolean;
  readonly deleteNode: boolean;
  readonly connect: boolean;
  readonly disconnect: boolean;
  readonly edgeLabel: boolean;
  readonly shape: boolean;
  readonly direction: boolean;
  readonly properties: boolean;
  /** Explains why Connect is intentionally absent for ordered/data grammars. */
  readonly connectionHint?: string;
}

export interface MermaidDiagramProperty {
  readonly id: string;
  readonly label: string;
  readonly value: string | boolean;
  readonly type?: 'text' | 'boolean' | 'select';
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly placeholder?: string;
  /** The property's value is rendered as one selectable text label. */
  readonly rendered?: boolean;
  /** Removing the rendered label can safely remove the property statement. */
  readonly deletable?: boolean;
}

export interface MermaidEditableNode {
  id: string;
  domId: string;
  label: string;
  shape: MermaidFlowchartShapeId;
  classes: readonly string[];
  /** Source adapter metadata. Never serialized into the Mermaid SVG. */
  origin?: Readonly<Record<string, string | number | boolean>>;
}

export type MermaidEditableTextTarget = 'node' | 'edge' | 'property' | 'source';

/** One authored text label that can be mapped safely back to Mermaid source. */
export interface MermaidEditableText {
  id: string;
  label: string;
  target: MermaidEditableTextTarget;
  targetId: string;
  deletable: boolean;
  /** Source adapter metadata. Never serialized into the Mermaid SVG. */
  origin?: Readonly<Record<string, string | number | boolean>>;
}

/** A single selection replaces the former independent node/edge selection state. */
export interface MermaidSelection {
  kind: 'node' | 'edge' | 'text';
  id: string;
}

export interface MermaidEditableEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  type?: string;
  stroke?: string;
  userDefinedId?: boolean;
  /** Source adapter metadata. Never serialized into the Mermaid SVG. */
  origin?: Readonly<Record<string, string | number | boolean>>;
}

export interface MermaidFlowchartModel {
  kind: 'flowchart';
  direction: MermaidFlowchartDirection;
  nodes: readonly MermaidEditableNode[];
  edges: readonly MermaidEditableEdge[];
  texts?: readonly MermaidEditableText[];
}

export interface MermaidSourceEditableModel {
  kind: Exclude<MermaidEditableDiagramKind, 'flowchart'>;
  nodes: readonly MermaidEditableNode[];
  edges: readonly MermaidEditableEdge[];
  texts?: readonly MermaidEditableText[];
  capabilities: MermaidEditCapabilities;
  properties: readonly MermaidDiagramProperty[];
  nodeNoun: string;
  edgeNoun: string;
  direction?: MermaidFlowchartDirection;
}

/** Structured editing is additive to full Mermaid rendering, never required by it. */
export type MermaidEditableModel = MermaidFlowchartModel | MermaidSourceEditableModel;

export const FLOWCHART_EDIT_CAPABILITIES: MermaidEditCapabilities = {
  addNode: true,
  renameNode: true,
  duplicateNode: true,
  deleteNode: true,
  connect: true,
  disconnect: true,
  edgeLabel: true,
  shape: true,
  direction: true,
  properties: true,
};

export function mermaidEditCapabilities(model: MermaidEditableModel): MermaidEditCapabilities {
  return model.kind === 'flowchart' ? FLOWCHART_EDIT_CAPABILITIES : model.capabilities;
}

/** All authored labels selectable in the rendered SVG, regardless of owner. */
export function mermaidEditableTexts(model: MermaidEditableModel): readonly MermaidEditableText[] {
  const caps = mermaidEditCapabilities(model);
  const properties = model.kind === 'flowchart' ? [] : model.properties;
  return [
    ...model.nodes
      .filter((node) => caps.renameNode && node.label.trim())
      .map((node) => ({
        id: `node:${node.id}`,
        label: node.label,
        target: 'node' as const,
        targetId: node.id,
        deletable: caps.deleteNode,
      })),
    ...model.edges
      .filter((edge) => caps.edgeLabel && edge.label.trim())
      .map((edge) => ({
        id: `edge:${edge.id}`,
        label: edge.label,
        target: 'edge' as const,
        targetId: edge.id,
        deletable: edge.origin?.labelDeletable !== false,
      })),
    ...properties
      .filter(
        (property) =>
          property.rendered && typeof property.value === 'string' && property.value.trim(),
      )
      .map((property) => ({
        id: `property:${property.id}`,
        label: String(property.value),
        target: 'property' as const,
        targetId: property.id,
        deletable: property.deletable === true,
      })),
    ...(model.texts ?? []),
  ];
}

export function mermaidDiagramProperties(
  model: MermaidEditableModel,
): readonly MermaidDiagramProperty[] {
  if (model.kind !== 'flowchart') return model.properties;
  return [
    {
      id: 'direction',
      label: 'Flow direction',
      value: model.direction === 'TD' ? 'TB' : model.direction,
      type: 'select',
      options: [
        { value: 'LR', label: 'Left to right' },
        { value: 'TB', label: 'Top to bottom' },
        { value: 'RL', label: 'Right to left' },
        { value: 'BT', label: 'Bottom to top' },
      ],
    },
  ];
}
