/** Mermaid 11.16 flowchart shape catalog used by the structured editor. */

export interface MermaidFlowchartShape {
  id: string;
  label: string;
  category: 'Basic' | 'Process' | 'Data' | 'Documents' | 'Symbols';
  aliases?: readonly string[];
}

/**
 * Every non-asset shape in Mermaid 11.16's expanded flowchart catalog.
 * `icon` and `image` are deliberately excluded: they require additional
 * asset-specific fields and, for icons, a host-registered icon pack.
 */
export const MERMAID_FLOWCHART_SHAPES = [
  { id: 'rect', label: 'Process', category: 'Basic', aliases: ['rectangle', 'proc'] },
  { id: 'rounded', label: 'Event', category: 'Basic', aliases: ['event'] },
  { id: 'stadium', label: 'Terminal', category: 'Basic', aliases: ['pill'] },
  { id: 'circle', label: 'Circle', category: 'Basic', aliases: ['circ'] },
  { id: 'dbl-circ', label: 'Double circle', category: 'Basic', aliases: ['double-circle'] },
  { id: 'diam', label: 'Decision', category: 'Basic', aliases: ['diamond', 'question'] },
  { id: 'hex', label: 'Preparation', category: 'Basic', aliases: ['hexagon', 'prepare'] },
  { id: 'tri', label: 'Extract', category: 'Basic', aliases: ['triangle'] },
  { id: 'odd', label: 'Odd', category: 'Basic' },

  { id: 'notch-rect', label: 'Card', category: 'Process', aliases: ['card'] },
  { id: 'delay', label: 'Delay', category: 'Process' },
  { id: 'div-rect', label: 'Divided process', category: 'Process', aliases: ['div-proc'] },
  { id: 'fork', label: 'Fork / join', category: 'Process', aliases: ['join'] },
  { id: 'lin-rect', label: 'Lined process', category: 'Process', aliases: ['lin-proc'] },
  { id: 'st-rect', label: 'Multi-process', category: 'Process', aliases: ['processes'] },
  { id: 'fr-rect', label: 'Subprocess', category: 'Process', aliases: ['subprocess'] },
  { id: 'tag-rect', label: 'Tagged process', category: 'Process', aliases: ['tag-proc'] },

  { id: 'lean-r', label: 'Input / output', category: 'Data', aliases: ['in-out'] },
  { id: 'lean-l', label: 'Output / input', category: 'Data', aliases: ['out-in'] },
  { id: 'datastore', label: 'Data store', category: 'Data', aliases: ['data-store'] },
  { id: 'cyl', label: 'Database', category: 'Data', aliases: ['database', 'db'] },
  { id: 'h-cyl', label: 'Direct access storage', category: 'Data', aliases: ['das'] },
  { id: 'lin-cyl', label: 'Disk storage', category: 'Data', aliases: ['disk'] },
  { id: 'bow-rect', label: 'Stored data', category: 'Data', aliases: ['stored-data'] },
  { id: 'win-pane', label: 'Internal storage', category: 'Data', aliases: ['window-pane'] },

  { id: 'doc', label: 'Document', category: 'Documents' },
  { id: 'docs', label: 'Multi-document', category: 'Documents', aliases: ['documents'] },
  { id: 'lin-doc', label: 'Lined document', category: 'Documents' },
  { id: 'tag-doc', label: 'Tagged document', category: 'Documents' },
  { id: 'flag', label: 'Paper tape', category: 'Documents', aliases: ['paper-tape'] },

  { id: 'bang', label: 'Bang', category: 'Symbols' },
  { id: 'cloud', label: 'Cloud', category: 'Symbols' },
  { id: 'hourglass', label: 'Collate', category: 'Symbols', aliases: ['collate'] },
  { id: 'bolt', label: 'Communication link', category: 'Symbols', aliases: ['com-link'] },
  { id: 'brace', label: 'Comment left', category: 'Symbols', aliases: ['comment'] },
  { id: 'brace-r', label: 'Comment right', category: 'Symbols' },
  { id: 'braces', label: 'Comment both', category: 'Symbols' },
  { id: 'curv-trap', label: 'Display', category: 'Symbols', aliases: ['display'] },
  { id: 'notch-pent', label: 'Loop limit', category: 'Symbols', aliases: ['loop-limit'] },
  { id: 'flip-tri', label: 'Manual file', category: 'Symbols', aliases: ['manual-file'] },
  { id: 'sl-rect', label: 'Manual input', category: 'Symbols', aliases: ['manual-input'] },
  { id: 'trap-t', label: 'Manual operation', category: 'Symbols', aliases: ['manual'] },
  { id: 'trap-b', label: 'Priority action', category: 'Symbols', aliases: ['priority'] },
  { id: 'f-circ', label: 'Junction', category: 'Symbols', aliases: ['junction'] },
  { id: 'sm-circ', label: 'Start', category: 'Symbols', aliases: ['start'] },
  { id: 'fr-circ', label: 'Stop', category: 'Symbols', aliases: ['stop'] },
  { id: 'cross-circ', label: 'Summary', category: 'Symbols', aliases: ['summary'] },
  { id: 'text', label: 'Text block', category: 'Symbols' },
] as const satisfies readonly MermaidFlowchartShape[];

export type MermaidFlowchartShapeId = (typeof MERMAID_FLOWCHART_SHAPES)[number]['id'];

const SHAPE_IDS = new Set<string>(MERMAID_FLOWCHART_SHAPES.map((shape) => shape.id));

const LEGACY_SHAPE_IDS: Readonly<Record<string, MermaidFlowchartShapeId>> = {
  square: 'rect',
  rectangle: 'rect',
  proc: 'rect',
  round: 'rounded',
  event: 'rounded',
  pill: 'stadium',
  subroutine: 'fr-rect',
  cylinder: 'cyl',
  database: 'cyl',
  db: 'cyl',
  diamond: 'diam',
  question: 'diam',
  hexagon: 'hex',
  prepare: 'hex',
  doublecircle: 'dbl-circ',
  'double-circle': 'dbl-circ',
  trapezoid: 'trap-b',
  inv_trapezoid: 'trap-t',
  lean_right: 'lean-r',
  lean_left: 'lean-l',
};

export function isMermaidFlowchartShapeId(value: string): value is MermaidFlowchartShapeId {
  return SHAPE_IDS.has(value);
}

/** Normalize legacy parser names and documented aliases to the general-syntax id. */
export function normalizeMermaidFlowchartShape(
  value: string | null | undefined,
): MermaidFlowchartShapeId {
  if (!value) return 'rect';
  if (isMermaidFlowchartShapeId(value)) return value;
  const legacy = LEGACY_SHAPE_IDS[value];
  if (legacy) return legacy;
  for (const shape of MERMAID_FLOWCHART_SHAPES) {
    if ('aliases' in shape && (shape.aliases as readonly string[]).includes(value)) return shape.id;
  }
  return 'rect';
}
