/**
 * Read diagram nodes + edges from the live Tiptap state.
 *
 * For a given parent heading position, walks the diagram section's child
 * headings, builds synthetic `Block` objects from their text + Pandoc
 * attributes, runs `computeDiagramLayout` from core to fill in missing
 * positions, and returns the result in the shape React Flow consumes.
 *
 * The hook re-derives on every editor transaction — no caching layer
 * means there's nothing to invalidate when the user types or the markdown
 * is reloaded from disk.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { Block } from '@bendyline/squisq/schemas';
import { computeDiagramLayout } from '@bendyline/squisq/doc';
import { listDiagramChildren } from './diagramCommands';

export interface DiagramRFNode {
  id: string;
  position: { x: number; y: number };
  data: { label: string };
  type?: string;
  /** Per-node width override (from the heading's `w=` Pandoc param). */
  width?: number;
  /** Per-node height override (from the heading's `h=` Pandoc param). */
  height?: number;
}

export interface DiagramRFEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface DiagramData {
  nodes: DiagramRFNode[];
  edges: DiagramRFEdge[];
  warnings: string[];
}

export function useDiagramData(editor: Editor, parentPos: number): DiagramData {
  // Track a version counter that bumps on every editor transaction so the
  // hook re-renders. We avoid storing the full doc to keep references
  // stable for React Flow's internal memoisation.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const onUpdate = () => setVersion((v) => v + 1);
    editor.on('transaction', onUpdate);
    return () => {
      editor.off('transaction', onUpdate);
    };
  }, [editor]);

  return useMemo(() => {
    const children = listDiagramChildren(editor, parentPos);
    // Per-node size overrides keyed by id, so the post-layout pass can
    // re-attach them without polluting the Block schema used by SSR.
    const sizeOverrides = new Map<string, { width?: number; height?: number }>();
    // Build synthetic Blocks for the layout helper.
    const syntheticBlocks: Block[] = children.map((c) => {
      const params = c.attrs.params ?? {};
      const xRaw = params.x;
      const yRaw = params.y;
      const x = xRaw != null ? Number(xRaw) : undefined;
      const y = yRaw != null ? Number(yRaw) : undefined;
      const wRaw = params.w;
      const hRaw = params.h;
      const w = wRaw != null ? Number(wRaw) : undefined;
      const h = hRaw != null ? Number(hRaw) : undefined;
      if (Number.isFinite(w) || Number.isFinite(h)) {
        sizeOverrides.set(c.id, {
          ...(Number.isFinite(w) ? { width: w as number } : {}),
          ...(Number.isFinite(h) ? { height: h as number } : {}),
        });
      }
      const blockMeta = c.attrs.blockMeta;
      const text = getHeadingText(c.node);
      return {
        id: c.id,
        startTime: 0,
        duration: 0,
        audioSegment: 0,
        title: text || c.id,
        ...(Number.isFinite(x) ? { x: x as number } : {}),
        ...(Number.isFinite(y) ? { y: y as number } : {}),
        ...(blockMeta?.connectsTo ? { connectsTo: blockMeta.connectsTo } : {}),
        ...(c.attrs.classes ? { classes: c.attrs.classes } : {}),
      };
    });

    const layout = computeDiagramLayout(syntheticBlocks);

    const nodes: DiagramRFNode[] = layout.nodes.map((n) => {
      const size = sizeOverrides.get(n.id);
      return {
        id: n.id,
        position: { x: n.x, y: n.y },
        data: { label: n.label },
        ...(size?.width != null ? { width: size.width } : {}),
        ...(size?.height != null ? { height: size.height } : {}),
      };
    });
    const edges: DiagramRFEdge[] = layout.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.type ? { label: e.type } : {}),
    }));

    return { nodes, edges, warnings: layout.warnings };
    // `version` is the dependency we track for transactions; editor and
    // parentPos shouldn't change on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, parentPos, version]);
}

function getHeadingText(node: import('@tiptap/pm/model').Node): string {
  let text = '';
  node.content.forEach((child) => {
    if (child.isText) text += child.text ?? '';
  });
  return text;
}
