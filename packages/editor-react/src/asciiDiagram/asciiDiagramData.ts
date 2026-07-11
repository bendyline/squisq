/**
 * Read direction of the ASCII diagram loop: fence text → canvas data.
 *
 * `useAsciiDiagramData` re-derives on every editor transaction (mirroring
 * the philosophy of the old heading-based `useDiagramData`: no store, so
 * nothing to invalidate). Parsing is memoized per PMNode instance by the
 * extension's WeakMap caches, so untouched fences cost nothing.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  asciiCellToCanvas,
  ASCII_CHAR_H,
  ASCII_CHAR_W,
  type AsciiDiagram,
} from '@bendyline/squisq/doc';
import type { DiagramEdge, DiagramNode } from '../diagram/types';
import { findAsciiDiagramBlockPos, parseAsciiDiagramForNode } from './AsciiDiagramExtension';

export interface AsciiDiagramView {
  /** Canvas nodes, containers ordered first so their cards paint behind. */
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  warnings: string[];
  style: 'unicode' | 'ascii';
  /** The current fence text. */
  text: string;
  /** The parse behind `nodes`/`edges` (grid units) — ops operate on this. */
  diagram: AsciiDiagram;
}

/** Grid model → canvas model, containers-first for paint order. */
export function asciiDiagramToCanvas(
  diagram: AsciiDiagram,
): Pick<AsciiDiagramView, 'nodes' | 'edges'> {
  const containerIds = new Set(
    diagram.nodes.map((n) => n.containerId).filter((id): id is string => id !== undefined),
  );
  const depthOf = (id: string | undefined): number => {
    let depth = 0;
    let current = diagram.nodes.find((n) => n.id === id);
    while (current?.containerId) {
      depth++;
      current = diagram.nodes.find((n) => n.id === current?.containerId);
      if (depth > diagram.nodes.length) break;
    }
    return depth;
  };
  const ordered = [...diagram.nodes].sort((a, b) => {
    const aContainer = containerIds.has(a.id) ? 0 : 1;
    const bContainer = containerIds.has(b.id) ? 0 : 1;
    return aContainer - bContainer || depthOf(a.id) - depthOf(b.id);
  });
  const nodes: DiagramNode[] = ordered.map((n) => ({
    id: n.id,
    position: asciiCellToCanvas(n.col, n.row),
    data: { label: n.label },
    width: n.wCols * ASCII_CHAR_W,
    height: n.hRows * ASCII_CHAR_H,
    ...(containerIds.has(n.id) ? { kind: 'container' as const } : {}),
  }));
  const edges: DiagramEdge[] = diagram.edges.map((e) => ({
    id: e.label ? `${e.source}->${e.target}:${e.label}` : `${e.source}->${e.target}`,
    source: e.source,
    target: e.target,
    ...(e.label ? { label: e.label } : {}),
    ...(e.directed ? {} : { directed: false }),
  }));
  return { nodes, edges };
}

/**
 * Live view of one registered ASCII diagram block. Returns null when the
 * block no longer exists or no longer parses (the extension will drop the
 * widget on its next pass).
 */
export function useAsciiDiagramData(editor: Editor, blockId: string): AsciiDiagramView | null {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const onUpdate = () => setVersion((v) => v + 1);
    editor.on('transaction', onUpdate);
    return () => {
      editor.off('transaction', onUpdate);
    };
  }, [editor]);

  return useMemo(() => {
    const pos = findAsciiDiagramBlockPos(editor, blockId);
    if (pos === null) return null;
    const node = editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'codeBlock') return null;
    const diagram = parseAsciiDiagramForNode(node);
    if (!diagram) return null;
    const { nodes, edges } = asciiDiagramToCanvas(diagram);
    return {
      nodes,
      edges,
      warnings: diagram.warnings,
      style: diagram.style,
      text: node.textContent,
      diagram,
    };
    // `version` tracks transactions; editor/blockId are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, blockId, version]);
}
