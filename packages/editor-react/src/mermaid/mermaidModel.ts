import type { MermaidFlowchartShapeId } from './mermaidShapes';

export type MermaidFlowchartDirection = 'TB' | 'TD' | 'BT' | 'RL' | 'LR';

export interface MermaidEditableNode {
  id: string;
  domId: string;
  label: string;
  shape: MermaidFlowchartShapeId;
  classes: readonly string[];
}

export interface MermaidEditableEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  type?: string;
  stroke?: string;
  userDefinedId?: boolean;
}

export interface MermaidFlowchartModel {
  kind: 'flowchart';
  direction: MermaidFlowchartDirection;
  nodes: readonly MermaidEditableNode[];
  edges: readonly MermaidEditableEdge[];
}

/** Structured editing is additive to full Mermaid rendering, never required by it. */
export type MermaidEditableModel = MermaidFlowchartModel;
