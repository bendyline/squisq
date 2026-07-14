/**
 * Loss-minimizing source transformations for structured Mermaid flowchart edits.
 *
 * Additive edits are represented as ordinary Mermaid declarations, preceded by
 * a private comment marker so later edits can update the declaration instead
 * of endlessly appending overrides. Destructive edits are deliberately
 * conservative: they only rewrite lines that can be associated with the
 * selected node/edge without dropping an unrelated edge.
 */

import type {
  MermaidEditableEdge,
  MermaidEditableNode,
  MermaidFlowchartDirection,
  MermaidFlowchartModel,
} from './mermaidModel';
import type { MermaidFlowchartShapeId } from './mermaidShapes';

const NODE_MARKER = '%% squisq:node ';
const EDGE_MARKER = '%% squisq:edge ';
const EDGE_TOKEN = /(?:<[-=.]+[ox>]?|[ox<]?[-=.]+[ox>]|~~~)/;

export interface MermaidSourceEditResult {
  ok: boolean;
  source: string;
  reason?: string;
}

export function isEditableMermaidNodeId(id: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(id);
}

function encodedId(id: string): string {
  return encodeURIComponent(id);
}

function splitLines(source: string): string[] {
  return source.split(/\r?\n/);
}

function joinLines(lines: readonly string[]): string {
  return lines.join('\n');
}

function withoutManagedBlock(source: string, marker: string): string {
  const lines = splitLines(source);
  const next: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== marker) {
      next.push(lines[index]);
      continue;
    }
    // Squisq-managed blocks are exactly marker + one Mermaid statement.
    index += 1;
    if (next.length > 0 && next[next.length - 1] === '' && lines[index + 1] === '') {
      next.pop();
    }
  }
  return joinLines(next);
}

function appendManagedBlock(source: string, marker: string, statement: string): string {
  const without = withoutManagedBlock(source, marker).replace(/[ \t]+$/gm, '');
  const separator = without.endsWith('\n\n') ? '' : without.endsWith('\n') ? '\n' : '\n\n';
  return `${without}${separator}  ${marker}\n  ${statement}`;
}

function formatNode(node: Pick<MermaidEditableNode, 'id' | 'label' | 'shape' | 'classes'>): string {
  const classes = node.classes
    .filter((className) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(className))
    .map((className) => `:::${className}`)
    .join('');
  return `${node.id}@{ shape: ${node.shape}, label: ${JSON.stringify(node.label)} }${classes}`;
}

export function upsertMermaidNode(
  source: string,
  node: Pick<MermaidEditableNode, 'id' | 'label' | 'shape' | 'classes'>,
): MermaidSourceEditResult {
  if (!isEditableMermaidNodeId(node.id)) {
    return {
      ok: false,
      source,
      reason: `Node id “${node.id}” is not safe for structured source editing.`,
    };
  }
  const marker = `${NODE_MARKER}${encodedId(node.id)}`;
  return { ok: true, source: appendManagedBlock(source, marker, formatNode(node)) };
}

export function renameMermaidNode(
  source: string,
  node: MermaidEditableNode,
  label: string,
): MermaidSourceEditResult {
  const nextLabel = label.trim();
  if (!nextLabel) return { ok: false, source, reason: 'A node label cannot be empty.' };
  if (nextLabel === node.label) return { ok: false, source, reason: 'The label is unchanged.' };
  return upsertMermaidNode(source, { ...node, label: nextLabel });
}

export function changeMermaidNodeShape(
  source: string,
  node: MermaidEditableNode,
  shape: MermaidFlowchartShapeId,
): MermaidSourceEditResult {
  if (shape === node.shape) return { ok: false, source, reason: 'The shape is unchanged.' };
  return upsertMermaidNode(source, { ...node, shape });
}

export function nextMermaidNodeId(model: MermaidFlowchartModel, base = 'node'): string {
  const ids = new Set(model.nodes.map((node) => node.id));
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}

export function addMermaidNode(
  source: string,
  model: MermaidFlowchartModel,
  shape: MermaidFlowchartShapeId = 'rect',
): MermaidSourceEditResult & { nodeId?: string } {
  const id = nextMermaidNodeId(model);
  const result = upsertMermaidNode(source, {
    id,
    label: 'New node',
    shape,
    classes: [],
  });
  return result.ok ? { ...result, nodeId: id } : result;
}

export function duplicateMermaidNode(
  source: string,
  model: MermaidFlowchartModel,
  node: MermaidEditableNode,
): MermaidSourceEditResult & { nodeId?: string } {
  const id = nextMermaidNodeId(model, `${node.id}_copy`);
  const result = upsertMermaidNode(source, {
    ...node,
    id,
    label: `${node.label} copy`,
  });
  return result.ok ? { ...result, nodeId: id } : result;
}

export function connectMermaidNodes(
  source: string,
  model: MermaidFlowchartModel,
  sourceId: string,
  targetId: string,
): MermaidSourceEditResult {
  if (sourceId === targetId) {
    return { ok: false, source, reason: 'Choose a different node to create a connection.' };
  }
  if (!isEditableMermaidNodeId(sourceId) || !isEditableMermaidNodeId(targetId)) {
    return { ok: false, source, reason: 'One of the node ids is not safe to rewrite.' };
  }
  if (model.edges.some((edge) => edge.source === sourceId && edge.target === targetId)) {
    return { ok: false, source, reason: 'Those nodes are already connected.' };
  }
  const marker = `${EDGE_MARKER}${encodedId(sourceId)} ${encodedId(targetId)}`;
  return {
    ok: true,
    source: appendManagedBlock(source, marker, `${sourceId} --> ${targetId}`),
  };
}

function withoutQuotedText(line: string): string {
  let quote = '';
  let escaped = false;
  let result = '';
  for (const char of line) {
    if (escaped) {
      result += quote ? ' ' : char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      result += quote ? ' ' : char;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      result += ' ';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      result += ' ';
      continue;
    }
    result += char;
  }
  return result;
}

function idRegex(id: string): RegExp {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?=$|[^A-Za-z0-9_-])`);
}

function lineReferencesNode(line: string, id: string): boolean {
  return idRegex(id).test(withoutQuotedText(line));
}

function referencedNodeIds(line: string, model: MermaidFlowchartModel): string[] {
  return model.nodes.filter((node) => lineReferencesNode(line, node.id)).map((node) => node.id);
}

function isEdgeLine(line: string): boolean {
  const stripped = withoutQuotedText(line).trim();
  return !stripped.startsWith('%%') && EDGE_TOKEN.test(stripped);
}

function formatEdgeLabel(label: string): string {
  // A literal pipe terminates Mermaid's pipe-delimited edge label. Preserve it
  // as an HTML entity so the authored label still round-trips through Mermaid.
  return `|${JSON.stringify(label.replace(/\|/g, '&#124;'))}|`;
}

function rewriteSimpleEdgeLabel(
  line: string,
  edge: MermaidEditableEdge,
  label: string,
): string | null {
  const stripped = withoutQuotedText(line);
  const operator = EDGE_TOKEN.exec(stripped);
  if (!operator) return null;

  const suffixStart = operator.index + operator[0].length;
  const suffix = line.slice(suffixStart);
  const existingPipeLabel = /^(\s*)\|([^|\r\n]*)\|/.exec(suffix);

  // Mermaid also accepts labels written between two link fragments, such as
  // `A -- label --> B`. Rewriting that form without a full statement parser
  // risks damaging its link style, so keep it source-only.
  if (edge.label && !existingPipeLabel) return null;

  const afterLabel = existingPipeLabel ? suffix.slice(existingPipeLabel[0].length) : suffix;
  const nextLabel = label ? formatEdgeLabel(label) : '';
  return `${line.slice(0, suffixStart)}${nextLabel}${afterLabel}`;
}

function lineIndent(line: string): string {
  return /^\s*/.exec(line)?.[0] ?? '';
}

function declarationFor(node: MermaidEditableNode, indent: string): string {
  return `${indent}${formatNode(node)}`;
}

/**
 * Remove a node when each affected edge line contains no edge between two
 * surviving nodes. This covers ordinary one-edge-per-line Mermaid (including
 * declarations on the edge) while refusing dense `A & B --> C & D` rewrites.
 */
export function deleteMermaidNode(
  source: string,
  model: MermaidFlowchartModel,
  nodeId: string,
): MermaidSourceEditResult {
  const selected = model.nodes.find((node) => node.id === nodeId);
  if (!selected) return { ok: false, source, reason: 'The selected node no longer exists.' };
  if (!isEditableMermaidNodeId(nodeId)) {
    return { ok: false, source, reason: 'This node id can only be edited in Source.' };
  }

  let working = withoutManagedBlock(source, `${NODE_MARKER}${encodedId(nodeId)}`);
  const lines = splitLines(working);
  const next: string[] = [];
  let removed = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith(EDGE_MARKER)) {
      const markerIds = trimmed.slice(EDGE_MARKER.length).split(/\s+/).map(decodeURIComponent);
      if (markerIds.includes(nodeId)) {
        removed = true;
        index += 1;
        continue;
      }
    }

    if (!lineReferencesNode(line, nodeId)) {
      next.push(line);
      continue;
    }

    if (isEdgeLine(line)) {
      const ids = referencedNodeIds(line, model);
      const survivingIds = ids.filter((id) => id !== nodeId);
      const losesSurvivingEdge = model.edges.some(
        (edge) =>
          edge.source !== nodeId &&
          edge.target !== nodeId &&
          survivingIds.includes(edge.source) &&
          survivingIds.includes(edge.target),
      );
      if (losesSurvivingEdge) {
        return {
          ok: false,
          source,
          reason:
            'This compact edge statement also contains unrelated connections; edit it in Source.',
        };
      }
      const indent = lineIndent(line);
      for (const id of survivingIds) {
        const survivor = model.nodes.find((node) => node.id === id);
        if (survivor) next.push(declarationFor(survivor, indent));
      }
      removed = true;
      continue;
    }

    // Preserve other nodes in a multi-node class assignment.
    const classMatch = /^(\s*class\s+)([^\s]+)(\s+.+)$/.exec(line);
    if (classMatch) {
      const ids = classMatch[2].split(',').filter((id) => id !== nodeId);
      if (ids.length > 0) next.push(`${classMatch[1]}${ids.join(',')}${classMatch[3]}`);
      removed = true;
      continue;
    }

    // Standalone declarations, style/click directives, and Squisq overrides
    // for the selected id can be dropped without touching another node.
    removed = true;
  }

  working = joinLines(next);
  return removed
    ? { ok: true, source: working.replace(/\n{3,}/g, '\n\n') }
    : { ok: false, source, reason: 'No safe source declaration was found for this node.' };
}

export function disconnectMermaidEdge(
  source: string,
  model: MermaidFlowchartModel,
  edge: MermaidEditableEdge,
): MermaidSourceEditResult {
  const managedMarker = `${EDGE_MARKER}${encodedId(edge.source)} ${encodedId(edge.target)}`;
  const withoutManaged = withoutManagedBlock(source, managedMarker);
  if (withoutManaged !== source) return { ok: true, source: withoutManaged };

  const sourceNode = model.nodes.find((node) => node.id === edge.source);
  const targetNode = model.nodes.find((node) => node.id === edge.target);
  if (!sourceNode || !targetNode) {
    return { ok: false, source, reason: 'The connection endpoints no longer exist.' };
  }

  const lines = splitLines(source);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isEdgeLine(line)) continue;
    if (!lineReferencesNode(line, edge.source) || !lineReferencesNode(line, edge.target)) continue;
    const ids = referencedNodeIds(line, model);
    if (ids.some((id) => id !== edge.source && id !== edge.target)) continue;
    const indent = lineIndent(line);
    lines.splice(index, 1, declarationFor(sourceNode, indent), declarationFor(targetNode, indent));
    return { ok: true, source: joinLines(lines) };
  }

  return {
    ok: false,
    source,
    reason: 'This connection is part of a compact Mermaid statement; edit it in Source.',
  };
}

/**
 * Add, update, or remove a label on a one-edge-per-line flowchart connection.
 * Managed Squisq edges and ordinary Mermaid pipe labels are both supported;
 * compact or otherwise ambiguous statements deliberately fall back to Source.
 */
export function setMermaidEdgeLabel(
  source: string,
  model: MermaidFlowchartModel,
  edge: MermaidEditableEdge,
  label: string,
): MermaidSourceEditResult {
  const nextLabel = label.trim();
  if (nextLabel === edge.label.trim()) {
    return { ok: false, source, reason: 'The connection label is unchanged.' };
  }
  if (!isEditableMermaidNodeId(edge.source) || !isEditableMermaidNodeId(edge.target)) {
    return { ok: false, source, reason: 'This connection can only be labeled in Source.' };
  }

  const lines = splitLines(source);
  const managedMarker = `${EDGE_MARKER}${encodedId(edge.source)} ${encodedId(edge.target)}`;
  const markerIndex = lines.findIndex((line) => line.trim() === managedMarker);
  if (markerIndex >= 0) {
    const statementIndex = markerIndex + 1;
    const statement = lines[statementIndex];
    const rewritten = statement ? rewriteSimpleEdgeLabel(statement, edge, nextLabel) : null;
    if (!rewritten) {
      return { ok: false, source, reason: 'This connection label can only be changed in Source.' };
    }
    lines[statementIndex] = rewritten;
    return { ok: true, source: joinLines(lines) };
  }

  const candidates = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => {
      if (!isEdgeLine(line)) return false;
      if (!lineReferencesNode(line, edge.source) || !lineReferencesNode(line, edge.target)) {
        return false;
      }
      const ids = referencedNodeIds(line, model);
      return !ids.some((id) => id !== edge.source && id !== edge.target);
    });

  if (candidates.length !== 1) {
    return {
      ok: false,
      source,
      reason: 'This connection is part of an ambiguous Mermaid statement; edit it in Source.',
    };
  }

  const candidate = candidates[0];
  const rewritten = rewriteSimpleEdgeLabel(candidate.line, edge, nextLabel);
  if (!rewritten) {
    return {
      ok: false,
      source,
      reason: 'This connection uses a label form that can only be changed in Source.',
    };
  }
  lines[candidate.index] = rewritten;
  return { ok: true, source: joinLines(lines) };
}

export function setMermaidFlowchartDirection(
  source: string,
  direction: MermaidFlowchartDirection,
): MermaidSourceEditResult {
  const header = /^(\s*)(flowchart|graph)\b[^\r\n]*$/m;
  if (!header.test(source)) {
    return { ok: false, source, reason: 'Only flowchart and graph headers have a direction.' };
  }
  const next = source.replace(header, (_match, indent: string, keyword: string) => {
    return `${indent}${keyword} ${direction}`;
  });
  return next === source
    ? { ok: false, source, reason: 'The direction is unchanged.' }
    : { ok: true, source: next };
}
